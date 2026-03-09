PS D:\Development\Projects\Halo> pnpm tauri dev

> halo@0.3.108 tauri D:\Development\Projects\Halo
> tauri "dev"

     Running BeforeDevCommand (`pnpm dev`)

> halo@0.3.108 dev D:\Development\Projects\Halo
> vite --host 127.0.0.1 --port 1420 --strictPort


  VITE v7.3.1  ready in 249 ms

  ➜  Local:   http://127.0.0.1:1420/
     Running DevCommand (`cargo  run --no-default-features --color always --`)
        Info Watching D:\Development\Projects\Halo\src-tauri for changes...
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.36s
     Running `target\debug\halo.exe`
[media_cmds] Fetching config from: https://www.iyouhun.com/tv/dc-xs
[media_cmds] Fetching config from: https://www.iyouhun.com/tv/zb
[media_cmds] Received 429 chars (remote)
[media_cmds] Fetching config from: https://9877.kstore.space/AnotherDS/movie.json
[media_cmds] Received 29059 chars (remote)
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[SpiderBridge] Invoking homeContent -> csp_AppRJ (Site: 热播影视, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
DEBUG: Injected hint fallback jar for csp_AppRJ: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: Added hint fallback jar to class scan: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: [Bridge] Invoking AppRJ.homeContent()
SPIDER_DEBUG: result [object code=1]
DEBUG: invokeMethod result type: java.lang.String
DEBUG: invokeMethod result value: [array len=1 first=object class=10 list=0 filters=10]
[SpiderBridge] Invoking categoryContent -> csp_AppRJ (Site: 热播影视, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
DEBUG: Injected hint fallback jar for csp_AppRJ: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: Added hint fallback jar to class scan: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: [Bridge] Invoking AppRJ.categoryContent()
SPIDER_DEBUG: result [object code=1]
DEBUG: invokeMethod result type: java.lang.String
DEBUG: invokeMethod result value: [array len=1 first=object list=12 page=1 pagecount=2147483647 total=2147483647]
[media_cmds] Received 289685 chars (remote)
[tvbox][resolver] unrecognized payload, trying decrypt proxies
[tvbox][proxy] trying decrypt proxy: https://www.qiushui.vip/raw/?url=https%3A%2F%2Fwww.iyouhun.com%2Ftv%2Fzb
[tvbox][proxy] proxy failed prefix=https://www.qiushui.vip/raw/?url= err=HTTP 404 Not Found for https://www.qiushui.vip/raw/?url=https%3A%2F%2Fwww.iyouhun.com%2Ftv%2Fzb
[tvbox][proxy] trying decrypt proxy: https://agit.ai/raw/?url=https%3A%2F%2Fwww.iyouhun.com%2Ftv%2Fzb
[tvbox][proxy] proxy returned non-tvbox content (prefix=https://agit.ai/raw/?url=)
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[SpiderBridge] Invoking homeContent -> csp_AppRJ (Site: 热播影视, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge] Invoking categoryContent -> csp_AppRJ (Site: 热播影视, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
DEBUG: Injected hint fallback jar for csp_AppRJ: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: Added hint fallback jar to class scan: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: [Bridge] Invoking AppRJ.homeContent()
SPIDER_DEBUG: result [object code=1]
DEBUG: invokeMethod result type: java.lang.String
DEBUG: invokeMethod result value: [array len=1 first=object class=10 list=0 filters=10]
[SpiderBridge:Log]
DEBUG: Injected hint fallback jar for csp_AppRJ: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: Added hint fallback jar to class scan: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: [Bridge] Invoking AppRJ.categoryContent()
SPIDER_DEBUG: result [object code=1]
DEBUG: invokeMethod result type: java.lang.String
DEBUG: invokeMethod result value: [array len=1 first=object list=12 page=1 pagecount=2147483647 total=2147483647]
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[SpiderBridge] Invoking homeContent -> csp_Douban (Site: 豆瓣, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[media_cmds] Fetching config from: https://fishapi.wya6.com/fish/fishhxq.php
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[SpiderBridge] Invoking homeContent -> csp_Hxq (Site: 韩圈, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
DEBUG: Injected hint fallback jar for csp_Hxq: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: Added hint fallback jar to class scan: D:\Development\Projects\Halo\src-tauri\target\debug\resources\jar\fallbacks\anotherds_spider.jar
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: invokeInit Pass 1 failed for method init
java.lang.reflect.InvocationTargetException
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:118)
at java.base/java.lang.reflect.Method.invoke(Method.java:580)
at com.halo.spider.BridgeRunner.invokeInit(BridgeRunner.java:575)
at com.halo.spider.BridgeRunner.main(BridgeRunner.java:161)
at com.halo.spider.BridgeRunnerCompat.main(BridgeRunnerCompat.java:12)
Caused by: java.lang.NoSuchMethodError: 'void com.github.catvod.crawler.Spider.init(android.content.Context, java.lang.String)'
at com.github.catvod.spider.Hxq.init(Unknown Source)
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
... 4 more
DEBUG: invokeInit Match Pass 2: init(String)
DEBUG: [Bridge] Invoking Hxq.homeContent()
DEBUG: invokeMethod result type: java.lang.String
DEBUG: invokeMethod result value: [array len=1 first=object list=0]
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[SpiderBridge] Invoking homeContent -> csp_BiliYS (Site: 哔哩视频, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: invokeInit Pass 1 failed for method init
java.lang.reflect.InvocationTargetException
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:118)
at java.base/java.lang.reflect.Method.invoke(Method.java:580)
[SpiderBridge] Invoking homeContent -> csp_BiliYS (Site: 哔哩视频, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
at com.halo.spider.BridgeRunner.invokeInit(BridgeRunner.java:575)
at com.halo.spider.BridgeRunner.main(BridgeRunner.java:161)
at com.halo.spider.BridgeRunnerCompat.main(BridgeRunnerCompat.java:12)
Caused by: java.lang.IncompatibleClassChangeError: Expected static method 'okhttp3.Dns com.github.catvod.crawler.Spider.safeDns()'
at com.github.catvod.spider.merge.E0.d.c.a(Unknown Source)
at com.github.catvod.spider.merge.E0.d.c.b(Unknown Source)
at com.github.catvod.spider.BiliYS$1.init(Unknown Source)
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
... 4 more
DEBUG: invokeInit Match Pass 4: init(Context)
DEBUG: [Bridge] Invoking BiliYS.homeContent()
java.lang.RuntimeException: invoke method failed: homeContent
at com.halo.spider.BridgeRunner.invokeMethod(BridgeRunner.java:679)
at com.halo.spider.BridgeRunner.main(BridgeRunner.java:164)
at com.halo.spider.BridgeRunnerCompat.main(BridgeRunnerCompat.java:12)
Caused by: java.lang.reflect.InvocationTargetException
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:118)
at java.base/java.lang.reflect.Method.invoke(Method.java:580)
at com.halo.spider.BridgeRunner.invokeMethod(BridgeRunner.java:666)
... 2 more
Caused by: java.lang.IncompatibleClassChangeError: Expected static method 'okhttp3.Dns com.github.catvod.crawler.Spider.safeDns()'
at com.github.catvod.spider.merge.E0.d.c.a(Unknown Source)
at com.github.catvod.spider.merge.E0.d.c.b(Unknown Source)
at com.github.catvod.spider.BiliYS$1.homeContent(Unknown Source)
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
... 4 more
[SpiderBridge:Log]
DEBUG: invokeInit Match Pass 1: init(Context, String)
DEBUG: [Bridge] Invoking BiliYS.homeContent()
java.lang.RuntimeException: invoke method failed: homeContent
at com.halo.spider.BridgeRunner.invokeMethod(BridgeRunner.java:679)
at com.halo.spider.BridgeRunner.main(BridgeRunner.java:164)
at com.halo.spider.BridgeRunnerCompat.main(BridgeRunnerCompat.java:12)
Caused by: java.lang.reflect.InvocationTargetException
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:115)
at java.base/java.lang.reflect.Method.invoke(Method.java:580)
at com.halo.spider.BridgeRunner.invokeMethod(BridgeRunner.java:666)
... 2 more
Caused by: java.lang.NullPointerException: Cannot read field "a" because "<local0>" is null
at com.github.catvod.spider.merge.E0.d.c.a(Unknown Source)
at com.github.catvod.spider.merge.E0.d.c.b(Unknown Source)
at com.github.catvod.spider.BiliYS$1.homeContent(Unknown Source)
at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
... 4 more
[media_cmds] Fetching config from: https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/XZYS.json
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[media_cmds] Received 158 chars (remote)
[tvbox][resolver] unrecognized payload, trying decrypt proxies
[tvbox][proxy] trying decrypt proxy: https://www.qiushui.vip/raw/?url=https%3A%2F%2Fgit.yylx.win%2Fraw.githubusercontent.com%2FPizazzGY%2FNewTVBox%2Fmain%2Fmovie%2Fjson%2FXZYS.json
[tvbox][proxy] proxy failed prefix=https://www.qiushui.vip/raw/?url= err=HTTP 404 Not Found for https://www.qiushui.vip/raw/?url=https%3A%2F%2Fgit.yylx.win%2Fraw.githubusercontent.com%2FPizazzGY%2FNewTVBox%2Fmain%2Fmovie%2Fjson%2FXZYS.json
[tvbox][proxy] trying decrypt proxy: https://agit.ai/raw/?url=https%3A%2F%2Fgit.yylx.win%2Fraw.githubusercontent.com%2FPizazzGY%2FNewTVBox%2Fmain%2Fmovie%2Fjson%2FXZYS.json
[tvbox][proxy] proxy returned non-tvbox content (prefix=https://agit.ai/raw/?url=)
[SpiderBridge] Invoking homeContent -> csp_XBPQ (Site: 小镇影视, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
DEBUG: invokeInit Match Pass 2: init(String)
DEBUG: [Bridge] Invoking Douban.homeContent()
DEBUG: Result.toString() generated: [{"class":[{"type_id":"hot_gaia","type_name":"热门电影"},{"type_id":"tv_hot","type_name":"热播剧集"},{"type_id":"show_hot","type_name":"热播综艺"},{"type_id":"movie","type_name":"电影筛选"},{"type_id":"tv","type_name":"电视筛选"},{"type_id":"rank_list_movie","type_name":"电影榜单"},{"type_id":"rank_list_tv","type_name":"电视剧榜单"}],"list":[{"vod_id":"msearch:36554061","vod_name":"逐玉","vod_pic":"https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2920718637.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：0"},{"vod_id":"msearch:37293378","vod_name":"非穷尽列举","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929789264.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：9.3"},{"vod_id":"msearch:35725771","vod_name":"我的山与海","vod_pic":"https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2930376513.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：0"},{"vod_id":"msearch:36901008","vod_name":"洛杉矶劫案","vod_pic":"https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2929956678.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.2"},{"vod_id":"msearch:35943650","vod_name":"纯真年代的爱情","vod_pic":"https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2930085518.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.3"},{"vod_id":"msearch:36474027","vod_name":"镖人：风起大漠","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929760596.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.5"},{"vod_id":"msearch:36317421","vod_name":"太平年","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2926587194.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：8.2"},{"vod_id":"msearch:36566053","vod_name":"除恶","vod_pic":"https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2930022669.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.4"},{"vod_id":"msearch:35424715","vod_name":"生命树","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929427616.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分 ：8.3"},{"vod_id":"msearch:37375594","vod_name":"夜王","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929673775.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.8"},{"vod_id":"msearch:36503073","vod_name":"暗黑新娘！","vod_pic":"https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2929036260.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：6.6"},{"vod_id":"msearch:37030864","vod_name":"订阅男友","vod_pic":"https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2930226213.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：0"},{"vod_id":"msearch:37311135","vod_name":"飞驰人生3","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929427346.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.3"},{"vod_id":"msearch:35461578","vod_name":"用武之地","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2928312004.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.4"},{"vod_id":"msearch:36963690","vod_name":"呼啸山庄","vod_pic":"https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2930195437.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：0"},{"vod_id":"msearch:35653016","vod_name":"玫瑰丛生","vod_pic":"https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2930046432.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：6.3"},{"vod_id":"msearch:36514978","vod_name":"成何体统","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929508444.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：7.2"},{"vod_id":"msearch:35861791","vod_name":"初步举证","vod_pic":"https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2918386473.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：9.5"},{"vod_id":"msearch:37242440","vod_name":"惊蛰无声","vod_pic":"https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2929759786.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：6.0"},{"vod_id":"msearch:35341071","vod_name":"七王国的骑 士 第一季","vod_pic":"https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2927626110.jpg@Referer=https://api.douban.com/@User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36","vod_remarks":"评分：8.9"}],"parse":0,"jx":0}]
DEBUG: invokeMethod result type: java.lang.String
DEBUG: invokeMethod result value: [array len=1 first=object class=7 list=20]
[SpiderBridge:Log]
java.lang.NoClassDefFoundError: com/github/catvod/crawler/SpiderApi
at java.base/java.lang.Class.getDeclaredMethods0(Native Method)
at java.base/java.lang.Class.privateGetDeclaredMethods(Class.java:3580)
at java.base/java.lang.Class.privateGetPublicMethods(Class.java:3605)
at java.base/java.lang.Class.getMethods(Class.java:2187)
at com.halo.spider.BridgeRunner.invokeInit(BridgeRunner.java:547)
at com.halo.spider.BridgeRunner.main(BridgeRunner.java:161)
at com.halo.spider.BridgeRunnerCompat.main(BridgeRunnerCompat.java:12)
Caused by: java.lang.ClassNotFoundException: com.github.catvod.crawler.SpiderApi
at java.base/java.net.URLClassLoader.findClass(URLClassLoader.java:445)
at com.halo.spider.BridgeRunner$1.findClass(BridgeRunner.java:135)
at java.base/java.lang.ClassLoader.loadClass(ClassLoader.java:593)
at java.base/java.lang.ClassLoader.loadClass(ClassLoader.java:526)
... 7 more
[media_cmds] Fetching config from: https://git.yylx.win/raw.githubusercontent.com/PizazzGY/NewTVBox/main/movie/json/HJKK.json
[SpiderBridge] prefetch_spider_jar OK: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar
[media_cmds] Received 1635 chars (remote)
[tvbox][resolver] unrecognized payload, trying decrypt proxies
[tvbox][proxy] trying decrypt proxy: https://www.qiushui.vip/raw/?url=https%3A%2F%2Fgit.yylx.win%2Fraw.githubusercontent.com%2FPizazzGY%2FNewTVBox%2Fmain%2Fmovie%2Fjson%2FHJKK.json
[tvbox][proxy] proxy failed prefix=https://www.qiushui.vip/raw/?url= err=HTTP 404 Not Found for https://www.qiushui.vip/raw/?url=https%3A%2F%2Fgit.yylx.win%2Fraw.githubusercontent.com%2FPizazzGY%2FNewTVBox%2Fmain%2Fmovie%2Fjson%2FHJKK.json
[tvbox][proxy] trying decrypt proxy: https://agit.ai/raw/?url=https%3A%2F%2Fgit.yylx.win%2Fraw.githubusercontent.com%2FPizazzGY%2FNewTVBox%2Fmain%2Fmovie%2Fjson%2FHJKK.json
[tvbox][proxy] proxy returned non-tvbox content (prefix=https://agit.ai/raw/?url=)
[SpiderBridge] Invoking homeContent -> csp_XBPQ (Site: 韩剧看看, Hint: D:\Development\Projects\Halo\src-tauri\target\debug\spiders\62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar)
[SpiderBridge:Log]
java.lang.NoClassDefFoundError: com/github/catvod/crawler/SpiderApi
at java.base/java.lang.Class.getDeclaredMethods0(Native Method)
at java.base/java.lang.Class.privateGetDeclaredMethods(Class.java:3580)
at java.base/java.lang.Class.privateGetPublicMethods(Class.java:3605)
at java.base/java.lang.Class.getMethods(Class.java:2187)
at com.halo.spider.BridgeRunner.invokeInit(BridgeRunner.java:547)
at com.halo.spider.BridgeRunner.main(BridgeRunner.java:161)
at com.halo.spider.BridgeRunnerCompat.main(BridgeRunnerCompat.java:12)
Caused by: java.lang.ClassNotFoundException: com.github.catvod.crawler.SpiderApi
at java.base/java.net.URLClassLoader.findClass(URLClassLoader.java:445)
at com.halo.spider.BridgeRunner$1.findClass(BridgeRunner.java:135)
at java.base/java.lang.ClassLoader.loadClass(ClassLoader.java:593)
at java.base/java.lang.ClassLoader.loadClass(ClassLoader.java:526)
... 7 more
[0309/002242.067:ERROR:ui\gfx\win\window_impl.cc:124] Failed to unregister class Chrome_WidgetWin_0. Error = 1412
PS D:\Development\Projects\Halo> 