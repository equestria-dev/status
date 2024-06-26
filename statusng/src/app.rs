use std::fs;
use std::path::Path;
use std::time::Duration;

use log::{debug, error, info, warn};

use statusng::error::StatusError;
use statusng::export::private::PrivateAPI;
use statusng::export::public::v1::PublicAPIv1;
use statusng::export::public::v2::PublicAPIv2;
use statusng::models::service::ServiceStatus;
use statusng::models::{Config, History};

pub struct App {
    pub(crate) config: Config,
    api: PrivateAPI,
    history: History,
}

impl App {
    pub fn build() -> Result<Self, StatusError> {
        let config = fs::read_to_string("./config.yaml")?;
        let config: Config = serde_yml::from_str(&config)?;
        debug!("Done loading config.yaml.");

        if Path::new("./history.json").exists() {
            info!("Found old history.json file, converting it to binary...");
            let history = fs::read_to_string("./history.json")?;
            let history: History = serde_json::from_str(&history)?;
            fs::write("./history.dat", history.into_bytes())?;
            fs::remove_file("./history.json")?;
        }

        let history = fs::read("./history.dat")?;
        let history = History::from_bytes(&history)?;
        debug!("Done loading history.dat.");

        let outage = config.outage.enabled.then_some(config.outage.clone());
        let api = PrivateAPI::new(outage);

        Ok(Self {
            config,
            api,
            history,
        })
    }

    pub fn run(mut self) {
        info!("Processing config...");

        let timeout = Duration::from_millis(self.config.timeout as u64);
        let slow_threshold = self.config.slow_threshold;

        for service in self.config.services {
            info!("{}", service);
            let result = service.process(timeout, slow_threshold);

            self.history.add_entry(&service, result.status);
            self.api.add(&service, &result);

            match result.status {
                ServiceStatus::Online => {
                    info!("{}: Online (ping: {} ms)", service.get_label(), result.ping)
                }
                ServiceStatus::Unstable => warn!(
                    "{}: Unstable (ping: {} ms)",
                    service.get_label(),
                    result.ping
                ),
                ServiceStatus::Offline => error!("{}: Offline", service.get_label()),
                ServiceStatus::Maintenance => info!(
                    "{}: Maintenance (ping: {} ms)",
                    service.get_label(),
                    result.ping
                ),
            }
        }

        self.history.vacuum();
        if let Err(e) = self.history.sync() {
            error!("Failed to save history to disk: {}", e);
        }

        info!("Saving private API data to disk and sending to Vercel...");
        self.api.seal(self.history);
        if let Err(e) = self.api.sync(&self.config.vercel_token) {
            error!("Failed to save private API data to disk: {}", e);
        }

        info!("Saving public API data to disk and sending to Vercel...");
        let public_api_v1 = PublicAPIv1::from_private_api(&self.api);
        let public_api_v2 = PublicAPIv2::from_private_api(&self.api);

        if let Err(e) = public_api_v1.sync(&self.config.vercel_token) {
            error!("Failed to save public API v1 data to disk: {}", e);
        }
        if let Err(e) = public_api_v2.sync(&self.config.vercel_token) {
            error!("Failed to save public API v2 data to disk: {}", e);
        }
    }
}
