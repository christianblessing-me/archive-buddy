//
//  SafariWebExtensionHandler.swift
//  simpleArchiver Extension
//
//  Created by Christian Blessing on 18.04.26.
//

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [], completionHandler: nil)
    }

}
