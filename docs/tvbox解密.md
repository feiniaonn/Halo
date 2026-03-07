<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TVBox接口解密</title>
    <link rel="stylesheet" href="https://cdn.bootcdn.net/ajax/libs/twitter-bootstrap/5.3.3/css/bootstrap.css">
    <style>
        body {
            margin-top: 40px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 0 15px;
        }
        .input-group {
            margin-bottom: 20px;
        }
        .loading {
            display: none;
            margin-top: 20px;
        }
        @media (max-width: 768px) {
            .container {
                max-width: 100%;
            }
        }
        .spinner-border {
            position: relative;
            width: 3rem;
            height: 3rem;
        }
        .spinner-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #000;
            font-size: 24px;
            font-weight: bold;
            white-space: nowrap;
            z-index: 1;
        }
        .loading {
            margin: 20px 0;
        }
    </style>
</head>
<body>
<div class="container">
        <h3 class="text-center mb-5">TVBox 接口解密</h3>
        <div class="input-group mb-3">
            <input type="text" class="form-control" id="url" value="" placeholder="输入接口地址，没地址？自己找百度有">
            <button class="btn btn-secondary" type="button" onclick="crawl()">解密</button>
        </div>
       
        <div class="text-center loading" id="loading">
          <div class="spinner-border" role="status">
            <span class="visually-hidden">Loading...</span>
            <div class="spinner-text">神</div>
          </div>
        </div>
        <textarea class="form-control" id="result" cols="80" rows="20" readonly></textarea>
        <div class="text-center mt-3">
            <button class="btn btn-primary" onclick="window.open('https://www.qiushui.vip')">官网</button>
            <button class="btn btn-warning" onclick="copyText()">复制</button>
            <button class="btn btn-danger" onclick="window.open('https://www.qiushui.vip/gj/jiemi/')">加密</button>
        </div>
    </div>
    <script>
        function crawl() {
            var xhr = new XMLHttpRequest();
            var url = document.getElementById("url").value;
            var resultBox = document.getElementById("result");
            xhr.open("GET", "./raw/?url=" + url, true);  
            xhr.onreadystatechange = function() {
                if (xhr.readyState == 4) {
                    document.getElementById("loading").style.display = "none";
                    var now = new Date();
                    var currentTime = now.getFullYear() + "-" + 
                        String(now.getMonth() + 1).padStart(2, "0") + "-" + 
                        String(now.getDate()).padStart(2, "0") + " " + 
                        String(now.getHours()).padStart(2, "0") + ":" + 
                        String(now.getMinutes()).padStart(2, "0") + ":" + 
                        String(now.getSeconds()).padStart(2, "0");
                    var headerText = "//  >>> 当前时间是：" + currentTime + " <<<\n" +
                                     "//  秋水导航【官网：www.qiushui.vip】！！！\n" +
                                     "//  当前接口：" + url + "\n\n";
                    if (xhr.status == 200) {
                        var responseText = xhr.responseText;
                        responseText = responseText.replace("Payment required", "解密失败");
                        responseText = responseText.replace("DEPLOYMENT_DISABLED", "请检查接口地址是否有误");
                        resultBox.value = headerText + responseText; 
                    } else {
                        var errorMessage = xhr.responseText || xhr.statusText;
                        errorMessage = errorMessage.replace("Payment required", "解密失败");
                        errorMessage = errorMessage.replace("DEPLOYMENT_DISABLED", "请检查接口地址是否有误");
                        resultBox.value = headerText + "解密失败：" + errorMessage;
                    }
                }
            };
            resultBox.value = "";
            document.getElementById("loading").style.display = "block";
            xhr.send();
        }

        function copyText() {
          var copyText = document.getElementById("result");
          copyText.select();
          copyText.setSelectionRange(0, 99999);
          document.execCommand("copy");
          alert("复制成功");
        }
    </script>
</body>
</html>