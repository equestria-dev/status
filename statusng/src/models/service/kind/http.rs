use serde::Deserialize;

use std::time::{Duration, Instant};

use log::debug;
use ureq::{Error, ErrorKind, Response};

use crate::models::service::{Service, ServiceProcessor};

#[derive(Deserialize, Debug)]
pub struct HttpService {
    pub url: String,
    #[serde(alias = "expect")]
    pub expected_code: u16,
    #[serde(default = "default_tls")]
    pub tls: bool
}

#[derive(Debug)]
pub enum HttpError {
    TransportError(Error),
    UnexpectedCode(u16),
}

fn default_tls() -> bool {
    true
}

impl HttpService {
    fn make_request(url: &str, timeout: Duration) -> Result<Response, Error> {
        let user_agent = format!("Mozilla/5.0 (Equestriadev; statusng; +https://status.equestria.dev) statusng/{}", crate::VERSION);

        ureq::get(url)
            .timeout(timeout)
            .set("User-Agent", &user_agent)
            .call()
    }

    //noinspection HttpUrlsUsage - Stupid RustRover
    fn get_url(&self, host: &str, port: u16) -> String {
        let mut url = String::new();

        url.push_str(if self.tls {
            "https://"
        } else {
            "http://"
        });

        url.push_str(host);

        let push_port = (self.tls && port != 443) || (!self.tls && port != 80);
        if push_port {
            url.push(':');
            url.push_str(&port.to_string());
        }

        if self.url.starts_with('/') {
            url.push_str(&self.url)
        } else {
            url.push('/');
            url.push_str(&self.url);
        };

        url
    }
}

impl ServiceProcessor<HttpError> for HttpService {
    fn process(&self, service: &Service, timeout: Duration) -> Result<u32, HttpError> {
        let url = self.get_url(&service.host, service.port);

        let start = Instant::now();
        let result = Self::make_request(&url, timeout);
        let ping = start.elapsed().as_millis() as u32;

        let response = match result {
            Ok(response) => Ok(response),
            Err(Error::Status(_, response)) => Ok(response),
            Err(e) => Err(e)
        }?;

        let code = response.status();
        debug!("ureq reported status code {}", code);

        if code == self.expected_code {
            Ok(ping)
        } else {
            Err(HttpError::UnexpectedCode(code))
        }
    }
}

impl From<Error> for HttpError {
    fn from(value: Error) -> Self {
        Self::TransportError(value)
    }
}
