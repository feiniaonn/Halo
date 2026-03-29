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

const IYOUHUN_DC_XS_MOVIE_FALLBACK: &str = r##"{
  "spider": "builtin://halo_spider.jar",
  "sites": [
    {
      "key": "豆瓣",
      "name": "豆瓣｜首页",
      "type": 3,
      "api": "csp_Douban"
    },
    {
      "key": "配置中心",
      "name": "配置｜中心",
      "type": 3,
      "api": "csp_Config"
    },
    {
      "key": "本地",
      "name": "本地｜视频",
      "type": 3,
      "api": "csp_LocalFile",
      "searchable": 1,
      "quickSearch": 1
    },
    {
      "key": "预告",
      "name": "新片｜预告",
      "type": 3,
      "api": "csp_YGP"
    },
    {
      "key": "热播影视",
      "name": "热播｜APP",
      "type": 3,
      "api": "csp_AppRJ",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "url": "http://v.rbotv.cn"
      }
    },
    {
      "key": "三秋影视",
      "name": "三秋｜APP",
      "type": 3,
      "api": "csp_App3Q",
      "searchable": 1,
      "quickSearch": 1
    },
    {
      "key": "坚果影视",
      "name": "坚果｜APP",
      "type": 3,
      "api": "csp_AppJg",
      "searchable": 1,
      "quickSearch": 1
    },
    {
      "key": "韩圈",
      "name": "韩圈｜APP",
      "type": 3,
      "api": "csp_Hxq",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://fishapi.wya6.com/fish/fishhxq.php"
    },
    {
      "key": "奴娜",
      "name": "奴娜丨APP",
      "type": 3,
      "api": "csp_AppYsV2",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1,
      "ext": "https://www.nntv.in/api.php/v1.vod"
    },
    {
      "key": "闪影",
      "name": "闪影｜APP",
      "type": 3,
      "api": "csp_AppYsV2",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1,
      "ext": "http://38.47.213.61:41271/mogai_api.php/v1.vod"
    },
    {
      "key": "段友",
      "name": "段友｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "dataIv": "8E2DC386FD452D05",
        "dataKey": "8E2DC386FD452D05",
        "url": "https://shangjihuoke.com"
      }
    },
    {
      "key": "黑猫",
      "name": "黑猫｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "dataIv": "VwsHxkCViDXEExWa",
        "dataKey": "VwsHxkCViDXEExWa",
        "url": "http://app1-0-0.87333.cc"
      }
    },
    {
      "key": "灵虎",
      "name": "灵虎｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "dataIv": "#getapp@TMD@2025",
        "dataKey": "#getapp@TMD@2025",
        "site": "https://bind.315999.xyz/89.txt"
      }
    },
    {
      "key": "小羊",
      "name": "小羊｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "dataIv": "7SDWjknU34zqFbVr",
        "dataKey": "7SDWjknU34zqFbVr",
        "site": "https://xy4k.com/url.txt"
      }
    },
    {
      "key": "七壹",
      "name": "七壹｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "dataIv": "45452893929B40D9",
        "dataKey": "45452893929B40D9",
        "url": "https://qiyiys.cc"
      }
    },
    {
      "key": "瑞奇",
      "name": "瑞奇｜APP",
      "type": 3,
      "api": "csp_AppGet",
      "searchable": 1,
      "quickSearch": 1,
      "ext": {
        "dataIv": "yangruiqiYsapp00",
        "dataKey": "yangruiqiYsapp00",
        "url": "http://rqxk.gdata.fun"
      }
    },
    {
      "key": "腾腾视频",
      "name": "腾腾｜视频",
      "type": 3,
      "api": "https://pan.vma.cc/pan/down.php/ec67b9045d393737f073d2c9365533f0.js",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/js/TXSP.js"
    },
    {
      "key": "酷酷视频",
      "name": "酷酷｜视频",
      "type": 3,
      "api": "https://pan.vma.cc/pan/down.php/ec67b9045d393737f073d2c9365533f0.js",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/js/YKSP.js"
    },
    {
      "key": "果果视频",
      "name": "果果｜视频",
      "type": 3,
      "api": "https://pan.vma.cc/pan/down.php/ec67b9045d393737f073d2c9365533f0.js",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/js/MGSP.js"
    },
    {
      "key": "奇奇视频",
      "name": "奇奇｜视频",
      "type": 3,
      "api": "https://pan.vma.cc/pan/down.php/ec67b9045d393737f073d2c9365533f0.js",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/js/AQY.js"
    },
    {
      "key": "三六零",
      "name": "三六零｜视频",
      "type": 3,
      "api": "csp_SP360",
      "searchable": 1,
      "quickSearch": 1
    },
    {
      "key": "甜圈短剧",
      "name": "甜圈｜短剧",
      "type": 3,
      "api": "csp_TianquanDJ",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "锦鲤短剧",
      "name": "锦鲤｜短剧",
      "type": 3,
      "api": "csp_JinliDJ",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "星阁短剧",
      "name": "星阁｜短剧",
      "type": 3,
      "api": "csp_XinggeDJ",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "碎片",
      "name": "碎片｜短剧",
      "type": 3,
      "api": "csp_SuipianDJ",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "星芽短剧",
      "name": "星芽｜短剧",
      "type": 3,
      "api": "./py/星芽短剧.py",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "剧王短剧",
      "name": "剧王｜短剧",
      "type": 3,
      "api": "./py/剧王短剧.py",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "厂长影视",
      "name": "厂长｜影视",
      "type": 3,
      "api": "csp_Czsapp",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1,
      "ext": "https://www.czzymovie.com"
    },
    {
      "key": "云播影视",
      "name": "云播｜影视",
      "type": 3,
      "api": "csp_Tvyb",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "http://www.tvyb03.com"
    },
    {
      "key": "饺子影视",
      "name": "饺子｜影视",
      "type": 3,
      "api": "csp_Jiaozi",
      "searchable": 1,
      "quickSearch": 1
    },
    {
      "key": "瓜子影视",
      "name": "瓜子｜影视",
      "type": 3,
      "api": "csp_Gz360",
      "searchable": 1,
      "quickSearch": 1
    },
    {
      "key": "骚火影视",
      "name": "骚火｜影视",
      "type": 3,
      "api": "csp_SaoHuo",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://shdy5.us"
    },
    {
      "key": "农民影视",
      "name": "农民｜影视",
      "type": 3,
      "api": "csp_Wwys",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://vip.wwgz.cn:5200"
    },
    {
      "key": "爱看机器人",
      "name": "爱看｜影视",
      "type": 3,
      "api": "csp_Ikanbot",
      "searchable": 1,
      "quickSearch": 1,
      "filterable": 1
    },
    {
      "key": "韩剧看看",
      "name": "韩剧｜影视",
      "type": 3,
      "api": "csp_XBPQ",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/HJKK.json"
    },
    {
      "key": "小镇影视",
      "name": "小镇｜影视",
      "type": 3,
      "api": "csp_XBPQ",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/XZYS.json"
    },
    {
      "key": "面包影视",
      "name": "面包｜影视",
      "type": 3,
      "api": "csp_XBPQ",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/MBYS.json"
    },
    {
      "key": "永乐影视",
      "name": "永乐｜影视",
      "type": 3,
      "api": "csp_XBPQ",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/YLYS.json"
    },
    {
      "key": "剧圈影视",
      "name": "剧圈｜影视",
      "type": 3,
      "api": "csp_XYQHiker",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/JQYS.json"
    },
    {
      "key": "来看影视",
      "name": "来看｜影视",
      "type": 3,
      "api": "csp_XYQHiker",
      "searchable": 1,
      "quickSearch": 1,
      "ext": "https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/LKYS.json"
    },
    {
      "key": "1905",
      "name": "1905｜影视",
      "type": 3,
      "api": "csp_Web1905",
      "searchable": 1
    },
    {
      "key": "应用商店",
      "name": "应用｜商店",
      "type": 3,
      "api": "csp_Market",
      "ext": "https://pizazz.s3.bitiful.net/market.json"
    },
    {
      "key": "push_agent",
      "name": "手机｜推送",
      "type": 3,
      "api": "csp_Push"
    }
  ]
}"##;

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
        "https://9877.kstore.space/AnotherDS/movie.json" => Some(IYOUHUN_DC_XS_MOVIE_FALLBACK),
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
    fn matches_iyouhun_movie_leaf_url() {
        assert!(resolve_known_source_fallback("https://9877.kstore.space/AnotherDS/movie.json")
            .is_some());
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
