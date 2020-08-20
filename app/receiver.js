/*
 * This software is the confidential and proprietary product of Nagravision S.A., OpenTV, Inc. or
 * its affiliates, the use of which is governed by
 * (i)the terms and conditions of the agreement you accepted by clicking that you agree or
 * (ii) such other agreement entered into between you and Nagravision S.A., OpenTV, Inc. or their affiliates.
 */

if (window.location.href.indexOf('Debug=true') != -1) {
  cast.receiver.logger.setLevelValue(cast.receiver.LoggerLevel.DEBUG);
  cast.player.api.setLoggerLevel(cast.player.api.LoggerLevel.DEBUG);
}

var mediaElement = document.getElementById('vid');

// Create the media manager. This will handle all media messages by default.
window.mediaManager = new cast.receiver.MediaManager(mediaElement);

// Remember the default value for the Receiver onLoad, so this sample can Play
// non-adaptive media as well.
window.defaultOnLoad = mediaManager.onLoad.bind(mediaManager)

// DRM data
let token = null;
let licenceUri = null;
let ssmClient = null;

mediaManager.onLoad = function (event) {
  // Reset DRM data
  token = null;
  licenceUri = null;
  if (ssmClient) {
    ssmClient.teardown();
    ssmClient = null;
  }

  // The Media Player Library requires that you call player unload between
  // different invocations.
  if (window.player !== null) {
    player.unload();    // Must unload before starting again.
    window.player = null;
  }
  // This trivial parser is by no means best practice, it shows how to access
  // event data, and uses the a string search of the suffix, rather than looking
  // at the MIME type which would be better.  In practice, you will know what
  // content you are serving while writing your player.
  if (event.data['media'] && event.data['media']['contentId']) {
    console.log('Starting media application');
    var url = event.data['media']['contentId'];
    // Create the Host - much of your interaction with the library uses the Host and
    // methods you provide to it.
    window.host = new cast.player.api.Host(
      {'mediaElement':mediaElement, 'url':url});
    var ext = url.substring(url.lastIndexOf('.'), url.length);
    var initStart = event.data['media']['currentTime'] || 0;
    var autoplay = event.data['autoplay'] || true;
    var protocol = null;
    mediaElement.autoplay = autoplay;  // Make sure autoplay get's set
    if (url.lastIndexOf('.m3u8') >= 0) {
    // HTTP Live Streaming
      protocol = cast.player.api.CreateHlsStreamingProtocol(host);
    } else if (url.lastIndexOf('.mpd') >= 0) {
    // MPEG-DASH
      protocol = cast.player.api.CreateDashStreamingProtocol(host);
    } else if (url.indexOf('.ism/') >= 0) {
    // Smooth Streaming
      protocol = cast.player.api.CreateSmoothStreamingProtocol(host);
    }

    // Extract custom data
    // Customise this to match the mapping from your sender app
    if (event.data['media']['customData']) {
      token = event.data['media']['customData']['token'];
      licenceUri = event.data['media']['customData']['widevineLicenceUri'];

      if (event.data['media']['customData']['ssmUri']) {
        ssmClient = new SsmClient(event.data['media']['customData']['ssmUri'], token);
        ssmClient.setup();
      }
    }

    // Override error handing
    host.onError = function(errorCode) {
      console.log("Fatal Error - " + errorCode);
      if (window.player) {
        window.player.unload();
        window.player = null;
      }
    };

    // Override license request
    host.updateLicenseRequestInfo = function(reqInfo) {
      console.log("License update requested")
      if (licenceUri && token) {
        reqInfo.url = licenceUri;

        reqInfo.headers["nv-authorizations"] = token;
        reqInfo.headers.Accept = "application/octet-stream";
        reqInfo.headers["content-type"] = "application/octet-stream";
      }

      if (ssmClient) {
        if (ssmClient.licenseRequested) { // Renewal request
          console.log("SSM license renewal requested");
          reqInfo.content = ssmClient.packagePayload(reqInfo.content);
          reqInfo.url = ssmClient.renewalUrl();
          reqInfo.headers["nv-authorizations"] = ssmClient.sessionToken;
          reqInfo.headers["content-type"] = "application/json";
        } else { // First licence request
          console.log("SSM initial license requested");
          reqInfo.headers["nv-authorizations"] = ssmClient.token();

          ssmClient.licenseRequested = true;
        }
      } else {
        reqInfo.headers["nv-authorizations"] = token;
      }
    };

    // Override licence processing
    if (ssmClient != null) {
      host.processLicense = ssmClient.unpackageLicense;
    }

    console.log("we have protocol " + ext);
    if (protocol !== null) {
      console.log("Starting Media Player Library");
      window.player = new cast.player.api.Player(host);
      window.player.load(protocol, initStart);
    }
    else {
      window.defaultOnLoad(event);    // do the default process
    }
  }
}

window.player = null;
console.log('Application is ready, starting system');
window.castReceiverManager = cast.receiver.CastReceiverManager.getInstance();

// Handle disconnections, must teardown an SSM session if one is in progress
window.castReceiverManager.onSenderDisconnected = function(event) {
  if(window.castReceiverManager.getSenders().length == 0) {
      if (ssmClient) {
        ssmClient.teardown();
        ssmClient = null;
      }
      window.close();
  }
}

// Handle playback stoppage and teardown SSM if there is one in progress
document.getElementById("vid").onended = function() {
  console.log("Playback ended");
  if (ssmClient) {
    ssmClient.teardown();
    ssmClient = null;
  }
};

castReceiverManager.start();

/**
 * Class to wrap SSM server calls
 */
class SsmClient {
  constructor(baseUrl, wholeToken) {
    this.baseUrl = baseUrl + "/v1";
    this.wholeToken = wholeToken;
    this.baseToken = wholeToken;
    if (this.baseToken.includes(",")) {
      this.baseToken = this.baseToken.split(",")[0];
    }
    this.sessionToken = null;
    this.licenseRequested = false;
  }

  token() {
    return `${this.wholeToken},${this.sessionToken}`;
  }

  renewalToken() {
    return `${this.baseToken},${this.sessionToken}`;
  }

  renewalUrl() {
    return `${this.baseUrl}/renewal-license-wv`;
  }


  /*
   * This needs to be called once playback is requested and before licences are requested.
   */
  setup() {
    var self = this;
    var endpoint = this.baseUrl + "/sessions/setup";

    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
      if (this.readyState == 4) {
        if (this.status == 200) {
          var response = JSON.parse(this.responseText);
          self.sessionToken = response.sessionToken;
        } else {
          console.error(`SSM setup failed with status ${this.status}`);
        }
      }
    };
    xhttp.open("POST", endpoint, false);
    xhttp.setRequestHeader("nv-authorizations", this.wholeToken)
    xhttp.send();
  }

  /**
   * This needs to be called whenever a playback session is stopped on the cast device.
   */
  teardown() {
    if (this.sessionToken == null) {
      console.warn("Attempted to teardown with no existing session")
      return;
    }
    var endpoint = this.baseUrl + "/sessions/teardown";

    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
      if (this.readyState == 4) {
        if (this.status == 200) {
          console.error("SSM teardown successful");
        } else {
          console.error(`SSM teardown failed with status ${this.status}`);
        }
      }
    };
    xhttp.open("POST", endpoint, false);
    xhttp.setRequestHeader("nv-authorizations", this.sessionToken)
    xhttp.send();
  }

  /**
   * When passing in a license response will check for JSON formatting and
   * return the first license in the object otherwise returns the
   * response unchanged.
   *
   * For SSM unpackaging the licence exposes the licence and a renewed session token.
   * @param {Uint8Array} response a byte array from the licence server
   */
  unpackageLicense(response) {
    console.log("Unpackaging license")
    let license = response;
    try {
      let responseStr = String.fromCharCode(...new Uint8Array(response));
      let responseObj = JSON.parse(responseStr);
      license = Uint8Array.from(atob(responseObj.license), c => c.charCodeAt(0));

      console.log("Storing renewed session token");
      this.sessionToken = responseObj.sessionToken;
    } catch (e) {
      //intentionally empty
    }
    return license;
  }

  /**
   * When inputting an EME licence-request message payload will return
   * a stringified json blob suitable for passing to SSP
   * @param {Uint8Array} message a byte array from EME request
   */
  packagePayload(message) {
    let base64String = btoa(String.fromCharCode(...new Uint8Array(message)));
    return `{"challenge":"${base64String}"}`;
  }
}
