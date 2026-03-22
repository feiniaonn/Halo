export function humanizeVodError(message: string): string {
  if (
    /jihulab\.com\/yoursmile2\/TVBox|Failed to download target spider JAR from all candidates/i.test(
      message,
    )
  ) {
    return 'Spider 运行资源预取失败，当前接口会在真实请求时继续重试；若连续失败，再提示切换接口。';
  }
  if (/libs directory not found|bridge\.jar not found/i.test(message)) {
    return 'Spider 运行库缺失，当前项目无法执行这类接口。';
  }
  if (/Missing desktop compatibility pack|compat pack missing|NeedsCompatPack/i.test(message)) {
    return '当前接口需要桌面兼容包，但兼容包未命中或加载失败。';
  }
  if (/Compat helper unavailable|helper failed health checks|NeedsLocalHelper|localhost helper/i.test(message)) {
    return '当前接口需要本地兼容服务，但 helper 启动或探活失败。';
  }
  if (/declares Context init|NeedsContextShim|context init/i.test(message)) {
    return '当前接口声明了 Android Context 初始化，需要经过桌面兼容层。';
  }
  if (/UnsatisfiedLinkError|Native Method|JNI|libstub\.so|\.so\b|NativeMethodBlocked/i.test(message)) {
    return '当前接口命中了 native/JNI 路径，桌面兼容层还没有把这条链接住。';
  }
  if (
    /dex-only|classes\.dex|Dex spider transform failed|no loadable \.class entries|explicit spider hint not found in JVM classpath/i.test(
      message,
    )
  ) {
    return '当前 Spider 还停在 dex 兼容阶段，桌面兼容层还没有把它转换成可直接执行的形态。';
  }
  return message;
}
