import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let cream = UIColor(red: 250/255, green: 246/255, blue: 234/255, alpha: 1)
        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = cream
        let bridgeViewController = CAPBridgeViewController()
        window?.rootViewController = bridgeViewController
        window?.makeKeyAndVisible()

        // Startup white strip (owner, 2026-11-05): during the first
        // seconds — while the remote page is still loading and the
        // WebView's layout height settles to the full screen — the
        // strip below the not-yet-painted content showed WHITE, even
        // though the launch image, the storyboard, the window and the
        // config background are all cream. That white is WebKit's
        // backing for the still-opaque WKWebView: nothing in app code
        // ever touched the WebView itself. The bridge controller's
        // view IS the WKWebView (Capacitor sets view = webView), so
        // paint every backing layer cream here and make the WebView
        // non-opaque: any not-yet-painted region now shows the cream
        // window behind it instead of WebKit's white backing.
        bridgeViewController.view.backgroundColor = cream
        if let webView = bridgeViewController.webView {
            webView.isOpaque = false
            webView.backgroundColor = cream
            webView.scrollView.backgroundColor = cream
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
