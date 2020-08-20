> This example includes a Javascript and an Android application that must both be running to get playback on the Chromecast.  
> See [here](https://codelabs.developers.google.com/codelabs/cast-receiver/#2) for help running this code locally.  
> To run the app you must register a receiver [here](https://cast.google.com/u/0/publish/#/overview), and change the `app_id` value in `res/values/strings.xml` to the receiver app ID.

> See [here](https://documentation.anycast.nagra.com/anycast1909/solutions/secure-session-management-ssm) for SSM documentation.

This application shows simple playback of encrypted and SSM streams on a Chromecast.

The points to take note of are:
- Overriding `MediaManager.onLoad(event)` allows access to the custom data through `event.data['media']['customData']`, which can be used to pass DRM information to the receiver.
- SSM setup is also carried out in `onLoad`. It must be performed when SSM playback has been selected, but before licences have been requested.
- Overriding `Host.updateLicenseRequestInfo(reqInfo)` allows the headers and destination for the licence request to be customised. For SSM this means setting the approriate headers depending on the whether the licence request is the initial request or a renewal, as well as redirecting the destination for SSM licence renewals.
- Overriding `Host.processLicense(licenseData)` allows the licence request response to be intercepted and processed before decryption. For SSM this is necessary as the licence request will return a combination of the licence and a new session token.
- SSM sessions must be torn down at playback end. Ensure that for every setup there is a corresponding teardown. For this demo we run the teardown on the video element end event, on disconnection from the sender app, and when switching between streams. Depending on your applications structure there may be other events when teardown must be called.
