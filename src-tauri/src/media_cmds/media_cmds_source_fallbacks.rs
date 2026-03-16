use url::Url;

const FEIMAO_REMOTE_CANDIDATES: &[&str] = &[
    "https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json",
    "https://gh-proxy.net/https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json",
    "https://gh-proxy.com/raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json",
];

const IYOUHUN_DC_XS_FALLBACK: &str = r#"{
  "spider": "builtin://halo_spider.jar",
  "wallpaper": "http://127.0.0.1:9978/proxy?do=wallpaper",
  "logo": "https://pic7.fukit.cn/autoupload/gE6Y0Af2tjXBCNig6CtNDI12_FRYNb81z6UPhMWD8iI/20251224/dJkT/1080X1080/logo.jpg/webp",
  "sites": [
    {
      "key": "豆瓣",
      "name": "豆瓣｜首页",
      "type": 3,
      "api": "csp_Douban",
      "searchable": 0
    },
    {
      "key": "本地",
      "name": "本地｜视频",
      "type": 3,
      "api": "csp_LocalFile"
    },
    {
      "key": "预告",
      "name": "新片｜预告",
      "type": 3,
      "api": "csp_YGP",
      "searchable": 0
    },
    {
      "key": "热播影视",
      "name": "热播｜APP",
      "type": 3,
      "api": "csp_AppRJ",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 0,
      "ext": {
        "url": "http://v.rbotv.cn"
      }
    },
    {
      "key": "韩圈",
      "name": "韩圈｜APP",
      "type": 3,
      "api": "csp_Hxq",
      "ext": "https://fishapi.wya6.com/fish/fishhxq.php"
    }
  ]
}"#;

const FEIMAO_FALLBACK: &str = r#"{
  "spider": "builtin://halo_spider.jar",
  "wallpaper": "https://深色壁纸.xxooo.cf/",
  "logo": "http://hello.xn--z7x900a.com/fm.gif",
  "sites": [
    {
      "key": "豆瓣",
      "name": "肥猫｜豆瓣",
      "type": 3,
      "api": "csp_Douban",
      "searchable": 0
    },
    {
      "key": "豆瓣预告",
      "name": "肥猫｜预告",
      "type": 3,
      "api": "csp_YGP",
      "playerType": 2,
      "searchable": 0
    },
    {
      "key": "潮流",
      "name": "潮流｜APP",
      "type": 3,
      "api": "csp_AppRJ",
      "ext": "http://v.rbotv.cn"
    },
    {
      "key": "肥猫",
      "name": "肥猫｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "ext": "https://wsapi.dafenqi.mom/yuming.txt|bH5mI8iK0tK7aQ5x"
    },
    {
      "key": "光盘",
      "name": "光盘｜APP",
      "type": 3,
      "api": "csp_AppQi",
      "ext": "https://uututv-1319209748.cos.ap-shanghai.myqcloud.com/uutuv4.txt|UrWKPnmQWJA8AQzd"
    },
    {
      "key": "农民",
      "name": "农民｜影视",
      "type": 3,
      "api": "csp_Wwys",
      "ext": "https://vip.wwgz.cn:5200"
    },
    {
      "key": "荐片",
      "name": "荐片｜影视",
      "type": 3,
      "api": "csp_Jianpian",
      "playerType": 2,
      "ext": "https://ev2089.zxbwv.com"
    },
    {
      "key": "烧火",
      "name": "烧火｜影视",
      "type": 3,
      "api": "csp_SaoHuo",
      "playerType": 2,
      "ext": "https://shdy5.us"
    },
    {
      "key": "瓜子",
      "name": "瓜子｜影视",
      "type": 3,
      "api": "csp_Gz360",
      "playerType": 2
    },
    {
      "key": "热播影视",
      "name": "热播｜影视",
      "type": 3,
      "api": "csp_LiteApple",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "厂长",
      "name": "厂长｜影视",
      "type": 3,
      "api": "csp_Czsapp",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1,
      "ext": "https://www.cz01.org"
    },
    {
      "key": "Kugou",
      "name": "酷狗｜音乐",
      "type": 3,
      "api": "csp_Kugou",
      "playerType": 2,
      "ext": {
        "classes": [
          {
            "type_name": "酷狗",
            "type_id": "kugou"
          }
        ]
      }
    }
  ]
}"#;

fn normalize_source_key(input: &str) -> String {
    let trimmed = input.trim().trim_matches(|c| c == '"' || c == '\'');
    let Ok(parsed) = Url::parse(trimmed) else {
        return trimmed.trim_end_matches('/').to_ascii_lowercase();
    };

    let scheme = parsed.scheme().to_ascii_lowercase();
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let mut path = parsed.path().trim_end_matches('/').to_string();
    if path.is_empty() {
        path = "/".to_string();
    }
    format!("{scheme}://{host}{path}")
}

pub fn resolve_known_source_fallback(url: &str) -> Option<&'static str> {
    match normalize_source_key(url).as_str() {
        "https://www.iyouhun.com/tv/dc-xs" => Some(IYOUHUN_DC_XS_FALLBACK),
        "http://xn--z7x900a.com/" | "http://xn--z7x900a.com" => Some(FEIMAO_FALLBACK),
        _ => None,
    }
}

pub fn resolve_known_source_redirect(url: &str) -> Option<&'static str> {
    match normalize_source_key(url).as_str() {
        "http://fty.xxooo.cf/tv"
        | "http://fty.xxooo.cf/tv/"
        | "http://www.xn--sss604efuw.com/tv"
        | "http://www.xn--sss604efuw.com/tv/"
        | "http://tvbox.xn--4kq62z5rby2qupq9ub.top"
        | "http://tvbox.xn--4kq62z5rby2qupq9ub.top/" => Some("http://www.xn--sss604efuw.net/tv"),
        _ => None,
    }
}

pub fn resolve_known_source_candidates(url: &str) -> &'static [&'static str] {
    match normalize_source_key(url).as_str() {
        "http://xn--z7x900a.com/" | "http://xn--z7x900a.com" => FEIMAO_REMOTE_CANDIDATES,
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_known_source_candidates, resolve_known_source_fallback,
        resolve_known_source_redirect,
    };

    #[test]
    fn matches_fatcat_chinese_domain_after_url_normalization() {
        assert!(resolve_known_source_fallback("http://肥猫.com").is_some());
        assert!(resolve_known_source_fallback("http://xn--z7x900a.com/").is_some());
    }

    #[test]
    fn matches_iyouhun_source_url() {
        assert!(resolve_known_source_fallback("https://www.iyouhun.com/tv/dc-xs").is_some());
    }

    #[test]
    fn bundled_fallbacks_use_builtin_spider_runtime() {
        let iyouhun = resolve_known_source_fallback("https://www.iyouhun.com/tv/dc-xs")
            .expect("iyouhun fallback");
        let feimao =
            resolve_known_source_fallback("http://xn--z7x900a.com/").expect("feimao fallback");
        assert!(iyouhun.contains("\"spider\": \"builtin://halo_spider.jar\""));
        assert!(feimao.contains("\"spider\": \"builtin://halo_spider.jar\""));
    }

    #[test]
    fn redirects_known_fantaiying_aliases_to_working_root() {
        assert_eq!(
            resolve_known_source_redirect("http://fty.xxooo.cf/tv"),
            Some("http://www.xn--sss604efuw.net/tv")
        );
        assert_eq!(
            resolve_known_source_redirect("http://www.饭太硬.com/tv"),
            Some("http://www.xn--sss604efuw.net/tv")
        );
        assert_eq!(
            resolve_known_source_redirect("http://tvbox.xn--4kq62z5rby2qupq9ub.top/"),
            Some("http://www.xn--sss604efuw.net/tv")
        );
    }

    #[test]
    fn exposes_known_feimao_remote_candidates() {
        let candidates = resolve_known_source_candidates("http://xn--z7x900a.com/");
        assert!(candidates
            .iter()
            .any(|item| item.contains("raw.githubusercontent.com")));
    }
}
