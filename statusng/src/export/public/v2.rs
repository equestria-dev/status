use std::fs;

use serde::Serialize;

use crate::error::StatusError;
use crate::export::private::PrivateAPI;
use crate::export::vercel::Vercel;
use crate::models::service::ServiceStatus;

#[derive(Serialize, Debug)]
pub struct PublicAPIv2<'a> {
    ping: f32,
    code: ServiceStatus,
    outages: Vec<&'a str>,
}

impl<'a> PublicAPIv2<'a> {
    pub fn from_private_api(private_api: &'a PrivateAPI) -> Self {
        let outages = private_api
            .services
            .iter()
            .filter_map(|i| match &i.status {
                ServiceStatus::Online => None,
                _ => Some(i.label.as_str()),
            })
            .collect();

        Self {
            ping: private_api.ping,
            code: private_api.global,
            outages,
        }
    }

    pub fn sync(self, token: &str) -> Result<(), StatusError> {
        let data = serde_json::to_string(&self)?;
        let vercel = Vercel::new(token);

        fs::write("./out-public-v2.json", &data)?;
        vercel.put(&data, "public/api-v2.json", 360)?;

        Ok(())
    }
}
