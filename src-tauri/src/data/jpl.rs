//! Clients for the JPL SSD APIs.

use super::{flag, num, text, ObjectRecord};
use crate::physics::kepler::Elements;
use crate::physics::risk::Covariance;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

const SSD: &str = "https://ssd-api.jpl.nasa.gov";

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(45))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("CosmoRisk/", env!("CARGO_PKG_VERSION"), " (+https://github.com/SpaceEngineerSS/CosmoRisk)"))
            .build()
            .expect("http client")
    })
}

async fn get_json(path: &str, query: &[(&str, String)]) -> Result<Value, String> {
    let url = format!("{SSD}/{path}");
    let resp = client().get(&url).query(query).send().await.map_err(|e| {
        if e.is_timeout() {
            "JPL did not answer in time. Check your connection and try again.".to_string()
        } else if e.is_connect() {
            "Could not reach ssd-api.jpl.nasa.gov. You might be offline.".to_string()
        } else {
            format!("Network error: {}", e.without_url())
        }
    })?;
    let status = resp.status();
    if status.as_u16() == 429 || status.as_u16() == 503 {
        return Err("JPL is rate-limiting requests right now. Wait a minute and retry.".into());
    }
    let body: Value = resp.json().await.map_err(|_| format!("JPL returned an unreadable response (HTTP {status})"))?;
    if !status.is_success() {
        let msg = body.get("message").and_then(text).unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("JPL: {msg}"));
    }
    Ok(body)
}

// ---------------------------------------------------------------------------
// Catalogue presets (SBDB Query API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogPreset {
    /// Potentially hazardous asteroids.
    Pha,
    /// NEOs larger than roughly 1 km (H < 17.75).
    LargeNeo,
    /// Brightest NEOs of any kind.
    Neo,
}

const QUERY_FIELDS: &str = "spkid,full_name,pdes,e,a,i,om,w,ma,epoch,H,diameter,albedo,pha,neo,class,moid,condition_code,spec_B,spec_T,rot_per";

pub async fn query_catalog(preset: CatalogPreset, limit: usize, offset: usize) -> Result<(Vec<ObjectRecord>, usize), String> {
    let mut q: Vec<(&str, String)> = vec![
        ("fields", QUERY_FIELDS.to_string()),
        ("full-prec", "1".into()),
        ("sort", "H".into()),
        ("limit", limit.clamp(1, 5000).to_string()),
    ];
    if offset > 0 {
        q.push(("limit-from", offset.to_string()));
    }
    match preset {
        CatalogPreset::Pha => q.push(("sb-group", "pha".into())),
        CatalogPreset::Neo => q.push(("sb-group", "neo".into())),
        CatalogPreset::LargeNeo => {
            q.push(("sb-group", "neo".into()));
            q.push(("sb-cdata", r#"{"AND":["H|LT|17.75"]}"#.into()));
        }
    }
    q.push(("sb-kind", "a".into()));
    let body = get_json("sbdb_query.api", &q).await?;
    let total = body.get("count").and_then(num).unwrap_or(0.0) as usize;
    let fields: Vec<String> = body
        .get("fields")
        .and_then(|f| f.as_array())
        .map(|a| a.iter().filter_map(text).collect())
        .unwrap_or_default();
    let col = |name: &str| fields.iter().position(|f| f == name);
    let rows = body.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();

    let idx = |n: &str| col(n);
    let (c_name, c_pdes, c_e, c_a, c_i, c_om, c_w, c_ma, c_epoch) =
        (idx("full_name"), idx("pdes"), idx("e"), idx("a"), idx("i"), idx("om"), idx("w"), idx("ma"), idx("epoch"));
    let (c_h, c_d, c_alb, c_pha, c_neo, c_class, c_moid, c_cc) =
        (idx("H"), idx("diameter"), idx("albedo"), idx("pha"), idx("neo"), idx("class"), idx("moid"), idx("condition_code"));
    let (c_sb, c_st, c_rot) = (idx("spec_B"), idx("spec_T"), idx("rot_per"));

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let r = match row.as_array() {
            Some(r) => r,
            None => continue,
        };
        let g = |c: Option<usize>| c.and_then(|k| r.get(k)).unwrap_or(&Value::Null);
        let deg = |c: Option<usize>| num(g(c)).map(f64::to_radians);
        let el = match (num(g(c_a)), num(g(c_e)), deg(c_i), deg(c_om), deg(c_w), deg(c_ma), num(g(c_epoch))) {
            (Some(a), Some(e), Some(i), Some(node), Some(peri), Some(m), Some(epoch)) => {
                Elements { a, e, i, node, peri, m, epoch }
            }
            _ => continue,
        };
        if !el.is_valid() {
            continue;
        }
        let id = match text(g(c_pdes)) {
            Some(id) => id,
            None => continue,
        };
        let diameter = num(g(c_d));
        let h = num(g(c_h));
        out.push(ObjectRecord {
            name: text(g(c_name)).unwrap_or_else(|| id.clone()),
            id,
            elements: el,
            h,
            diameter_km: diameter,
            diameter_estimated: diameter.is_none(),
            albedo: num(g(c_alb)),
            pha: flag(g(c_pha)),
            neo: flag(g(c_neo)),
            orbit_class: text(g(c_class)),
            moid_au: num(g(c_moid)),
            condition_code: num(g(c_cc)).map(|x| x as u8),
            spectral: text(g(c_sb)).or_else(|| text(g(c_st))),
            rotation_h: num(g(c_rot)),
            covariance: None,
            sentry: false,
            source: "SBDB query".into(),
        });
    }
    Ok((out, total))
}

// ---------------------------------------------------------------------------
// Single object (SBDB API)
// ---------------------------------------------------------------------------

pub async fn sbdb_object(designation: &str) -> Result<ObjectRecord, String> {
    let q = [
        ("sstr", designation.trim().to_string()),
        ("phys-par", "1".into()),
        ("cov", "mat".into()),
        ("full-prec", "1".into()),
    ];
    let body = get_json("sbdb.api", &q).await?;
    if body.get("list").is_some() {
        return Err(format!("\"{designation}\" matches several objects. Use the full designation."));
    }
    if let Some(msg) = body.get("message").and_then(text) {
        return Err(format!("JPL: {msg}"));
    }
    parse_sbdb(&body).ok_or_else(|| format!("No usable orbit for \"{designation}\""))
}

fn parse_sbdb(body: &Value) -> Option<ObjectRecord> {
    let obj = body.get("object")?;
    let orbit = body.get("orbit")?;
    let epoch = num(orbit.get("epoch")?)?;
    let elems = orbit.get("elements")?.as_array()?;
    let el_val = |name: &str| -> Option<f64> {
        elems.iter().find(|e| e.get("name").and_then(|n| n.as_str()) == Some(name)).and_then(|e| num(e.get("value")?))
    };
    let elements = Elements {
        a: el_val("a")?,
        e: el_val("e")?,
        i: el_val("i")?.to_radians(),
        node: el_val("om")?.to_radians(),
        peri: el_val("w")?.to_radians(),
        m: el_val("ma")?.to_radians(),
        epoch,
    };
    if !elements.is_valid() {
        return None;
    }

    let phys = body.get("phys_par").and_then(|p| p.as_array()).cloned().unwrap_or_default();
    let pp_num = |name: &str| -> Option<f64> {
        phys.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name)).and_then(|p| num(p.get("value")?))
    };
    let pp_text = |name: &str| -> Option<String> {
        phys.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name)).and_then(|p| text(p.get("value")?))
    };

    let covariance = orbit.get("covariance").and_then(parse_covariance);
    let id = text(obj.get("des")?)?;
    let diameter = pp_num("diameter");
    Some(ObjectRecord {
        name: text(obj.get("fullname").unwrap_or(&Value::Null)).unwrap_or_else(|| id.clone()),
        id,
        elements,
        h: pp_num("H"),
        diameter_km: diameter,
        diameter_estimated: diameter.is_none(),
        albedo: pp_num("albedo"),
        pha: flag(obj.get("pha").unwrap_or(&Value::Null)),
        neo: flag(obj.get("neo").unwrap_or(&Value::Null)),
        orbit_class: obj.get("orbit_class").and_then(|c| c.get("code")).and_then(text),
        moid_au: orbit.get("moid").and_then(num),
        condition_code: orbit.get("condition_code").and_then(num).map(|x| x as u8),
        spectral: pp_text("spec_B").or_else(|| pp_text("spec_T")),
        rotation_h: pp_num("rot_per"),
        covariance,
        sentry: false,
        source: "SBDB".into(),
    })
}

fn parse_covariance(c: &Value) -> Option<Covariance> {
    let epoch = num(c.get("epoch")?)?;
    let labels: Vec<String> = c.get("labels")?.as_array()?.iter().filter_map(text).collect();
    let want = ["e", "q", "tp", "node", "peri", "i"];
    let idx: Vec<usize> = want.iter().map(|w| labels.iter().position(|l| l == w)).collect::<Option<_>>()?;
    let data = c.get("data")?.as_array()?;
    let mut matrix = [[0.0; 6]; 6];
    for (i, &ri) in idx.iter().enumerate() {
        let row = data.get(ri)?.as_array()?;
        for (j, &cj) in idx.iter().enumerate() {
            matrix[i][j] = num(row.get(cj)?)?;
        }
    }
    let elems = c.get("elements")?.as_array()?;
    let mut nominal = [0.0; 6];
    for (k, w) in want.iter().enumerate() {
        nominal[k] = elems
            .iter()
            .find(|e| e.get("label").and_then(|n| n.as_str()) == Some(w))
            .and_then(|e| num(e.get("value")?))?;
    }
    Some(Covariance { epoch, nominal, matrix })
}

// ---------------------------------------------------------------------------
// Close approaches (CAD API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseApproach {
    pub des: String,
    pub name: String,
    pub jd: f64,
    pub date: String,
    pub dist_au: f64,
    pub dist_min_au: f64,
    pub dist_max_au: f64,
    pub v_rel_kms: f64,
    pub h: Option<f64>,
}

/// Close approaches to Earth. `des` limits to one object.
pub async fn close_approaches(des: Option<&str>, date_min: &str, date_max: &str, dist_max_au: f64) -> Result<Vec<CloseApproach>, String> {
    let mut q: Vec<(&str, String)> = vec![
        ("date-min", date_min.to_string()),
        ("date-max", date_max.to_string()),
        ("dist-max", format!("{dist_max_au}")),
        ("fullname", "true".into()),
        ("sort", "date".into()),
    ];
    if let Some(d) = des {
        q.push(("des", d.trim().to_string()));
    }
    let body = get_json("cad.api", &q).await?;
    let fields: Vec<String> = body
        .get("fields")
        .and_then(|f| f.as_array())
        .map(|a| a.iter().filter_map(text).collect())
        .unwrap_or_default();
    let col = |n: &str| fields.iter().position(|f| f == n);
    let rows = body.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    let (c_des, c_jd, c_cd, c_dist, c_min, c_max, c_v, c_h, c_name) =
        (col("des"), col("jd"), col("cd"), col("dist"), col("dist_min"), col("dist_max"), col("v_rel"), col("h"), col("fullname"));
    let mut out = Vec::new();
    for row in rows {
        let r = match row.as_array() {
            Some(r) => r,
            None => continue,
        };
        let g = |c: Option<usize>| c.and_then(|k| r.get(k)).unwrap_or(&Value::Null);
        let (Some(des), Some(jd), Some(dist)) = (text(g(c_des)), num(g(c_jd)), num(g(c_dist))) else {
            continue;
        };
        out.push(CloseApproach {
            name: text(g(c_name)).unwrap_or_else(|| des.clone()),
            des,
            jd,
            date: text(g(c_cd)).unwrap_or_default(),
            dist_au: dist,
            dist_min_au: num(g(c_min)).unwrap_or(dist),
            dist_max_au: num(g(c_max)).unwrap_or(dist),
            v_rel_kms: num(g(c_v)).unwrap_or(0.0),
            h: num(g(c_h)),
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Sentry impact monitoring
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryEntry {
    pub des: String,
    pub name: String,
    pub ip: f64,
    pub ps_cum: f64,
    pub ps_max: f64,
    pub ts_max: u8,
    pub n_imp: u32,
    pub range: String,
    pub diameter_km: Option<f64>,
    pub h: Option<f64>,
    pub v_inf_kms: Option<f64>,
    pub last_obs: String,
}

pub async fn sentry_list() -> Result<Vec<SentryEntry>, String> {
    let body = get_json("sentry.api", &[]).await?;
    let rows = body.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    let mut out: Vec<SentryEntry> = rows
        .iter()
        .filter_map(|r| {
            let des = text(r.get("des")?)?;
            Some(SentryEntry {
                name: r.get("fullname").and_then(text).unwrap_or_else(|| des.clone()),
                des,
                ip: r.get("ip").and_then(num).unwrap_or(0.0),
                ps_cum: r.get("ps_cum").and_then(num).unwrap_or(-99.0),
                ps_max: r.get("ps_max").and_then(num).unwrap_or(-99.0),
                ts_max: r.get("ts_max").and_then(num).unwrap_or(0.0) as u8,
                n_imp: r.get("n_imp").and_then(num).unwrap_or(0.0) as u32,
                range: r.get("range").and_then(text).unwrap_or_default(),
                diameter_km: r.get("diameter").and_then(num),
                h: r.get("h").and_then(num),
                v_inf_kms: r.get("v_inf").and_then(num),
                last_obs: r.get("last_obs").and_then(text).unwrap_or_default(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.ps_cum.partial_cmp(&a.ps_cum).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryImpact {
    pub date: String,
    pub ip: f64,
    pub ps: f64,
    pub ts: u8,
    pub energy_mt: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentryDetail {
    pub des: String,
    pub ip: f64,
    pub ps_cum: f64,
    pub ts_max: u8,
    pub energy_mt: Option<f64>,
    pub mass_kg: Option<f64>,
    pub v_imp_kms: Option<f64>,
    pub v_inf_kms: Option<f64>,
    pub method: String,
    pub computed: String,
    pub impacts: Vec<SentryImpact>,
    /// Set when the object has been removed from the risk list.
    pub removed: Option<String>,
}

pub async fn sentry_object(des: &str) -> Result<SentryDetail, String> {
    let body = get_json("sentry.api", &[("des", des.trim().to_string())]).await?;
    if let Some(removed) = body.get("removed").and_then(text) {
        return Ok(SentryDetail {
            des: des.to_string(),
            ip: 0.0,
            ps_cum: -99.0,
            ts_max: 0,
            energy_mt: None,
            mass_kg: None,
            v_imp_kms: None,
            v_inf_kms: None,
            method: String::new(),
            computed: String::new(),
            impacts: Vec::new(),
            removed: Some(removed),
        });
    }
    if let Some(err) = body.get("error").and_then(text) {
        return Err(format!("Sentry: {err}"));
    }
    let s = body.get("summary").ok_or("Sentry: missing summary")?;
    let impacts = body
        .get("data")
        .and_then(|d| d.as_array())
        .map(|rows| {
            rows.iter()
                .map(|r| SentryImpact {
                    date: r.get("date").and_then(text).unwrap_or_default(),
                    ip: r.get("ip").and_then(num).unwrap_or(0.0),
                    ps: r.get("ps").and_then(num).unwrap_or(-99.0),
                    ts: r.get("ts").and_then(num).unwrap_or(0.0) as u8,
                    energy_mt: r.get("energy").and_then(num),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(SentryDetail {
        des: s.get("des").and_then(text).unwrap_or_else(|| des.to_string()),
        ip: s.get("ip").and_then(num).unwrap_or(0.0),
        ps_cum: s.get("ps_cum").and_then(num).unwrap_or(-99.0),
        ts_max: s.get("ts_max").and_then(num).unwrap_or(0.0) as u8,
        energy_mt: s.get("energy").and_then(num),
        mass_kg: s.get("mass").and_then(num),
        v_imp_kms: s.get("v_imp").and_then(num),
        v_inf_kms: s.get("v_inf").and_then(num),
        method: s.get("method").and_then(text).unwrap_or_default(),
        computed: s.get("cdate").and_then(text).unwrap_or_default(),
        impacts,
        removed: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sbdb_sample() {
        let body: Value = serde_json::from_str(include_str!("../../tests/sbdb_apophis.json")).unwrap();
        let rec = parse_sbdb(&body).expect("record");
        assert_eq!(rec.id, "99942");
        assert!(rec.pha && rec.neo);
        assert!((rec.elements.a - 0.9223592206975018).abs() < 1e-12);
        assert!(rec.covariance.is_some());
        assert_eq!(rec.diameter_km, Some(0.34));
    }
}
