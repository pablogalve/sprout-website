(function () {
    const config = window.sproutAnalyticsConfig || {};
    const measurementId = config.ga4MeasurementId || "";
    const measurementIdPattern = /^G-[A-Z0-9]+$/;
    const consentStorageKey = "sproutAnalyticsConsent";
    const consentAcceptedValue = "accepted";
    const consentDeclinedValue = "declined";
    const eventTimeoutMilliseconds = 1200;
    const analyticsScriptBaseUrl = "https://www.googletagmanager.com/gtag/js?id=";
    const analyticsLinkSelector = "[data-analytics-event]";
    const dataAttributePrefix = "analytics";
    const eventAttributeName = "analyticsEvent";

    function hasValidMeasurementId() {
        return measurementIdPattern.test(measurementId);
    }

    function hasDoNotTrackEnabled() {
        return navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1";
    }

    function getStoredConsent() {
        try {
            return window.localStorage.getItem(consentStorageKey);
        } catch (_) {
            return null;
        }
    }

    function storeConsent(value) {
        try {
            window.localStorage.setItem(consentStorageKey, value);
        } catch (_) {}
    }

    function initializeDataLayer() {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag() {
            window.dataLayer.push(arguments);
        };
    }

    function configureAnalytics() {
        initializeDataLayer();
        window.gtag("consent", "default", {
            ad_personalization: "denied",
            ad_storage: "denied",
            ad_user_data: "denied",
            analytics_storage: "granted",
        });
        window.gtag("js", new Date());
        window.gtag("config", measurementId, {
            allow_ad_personalization_signals: false,
            allow_google_signals: false,
            page_path: window.location.pathname,
            page_title: document.title,
        });
    }

    function trackEvent(name, parameters) {
        if (!window.gtag) return;
        window.gtag("event", name, parameters);
    }

    function trackPageView() {
        const pageName = document.body.dataset.analyticsPage;
        if (!pageName) return;
        trackEvent("website_page_view", {
            page_location: window.location.href,
            page_path: window.location.pathname,
            page_title: document.title,
            website_page: pageName,
        });
    }

    function loadAnalytics() {
        if (window.sproutAnalyticsLoaded) return;
        configureAnalytics();
        const script = document.createElement("script");
        script.async = true;
        script.src = `${analyticsScriptBaseUrl}${encodeURIComponent(measurementId)}`;
        document.head.append(script);
        window.sproutAnalyticsLoaded = true;
        trackPageView();
    }

    function analyticsParameterName(dataKey) {
        return dataKey
            .slice(dataAttributePrefix.length)
            .replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)
            .replace(/^_/, "");
    }

    function analyticsParametersFromLink(link) {
        const parameters = {
            link_url: link.href,
        };
        Object.entries(link.dataset).forEach(([key, value]) => {
            if (!key.startsWith(dataAttributePrefix) || key === eventAttributeName) return;
            parameters[analyticsParameterName(key)] = value;
        });
        return parameters;
    }

    function shouldDelayNavigation(event, link) {
        if (!link.href || link.target === "_blank") return false;
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        return link.origin === window.location.origin || link.protocol.startsWith("http");
    }

    function trackLinkClick(event) {
        const link = event.currentTarget;
        const eventName = link.dataset.analyticsEvent;
        if (!eventName || !window.gtag) return;

        const parameters = analyticsParametersFromLink(link);
        if (!shouldDelayNavigation(event, link)) {
            trackEvent(eventName, parameters);
            return;
        }

        event.preventDefault();
        let hasNavigated = false;
        const navigate = () => {
            if (hasNavigated) return;
            hasNavigated = true;
            window.location.href = link.href;
        };

        trackEvent(eventName, {
            ...parameters,
            event_callback: navigate,
            event_timeout: eventTimeoutMilliseconds,
        });
        window.setTimeout(navigate, eventTimeoutMilliseconds);
    }

    function attachLinkTracking() {
        document.querySelectorAll(analyticsLinkSelector).forEach((link) => {
            link.addEventListener("click", trackLinkClick);
        });
    }

    function removeConsentBanner() {
        const banner = document.querySelector(".analytics-consent");
        if (banner) banner.remove();
    }

    function acceptAnalytics() {
        storeConsent(consentAcceptedValue);
        removeConsentBanner();
        loadAnalytics();
    }

    function declineAnalytics() {
        storeConsent(consentDeclinedValue);
        removeConsentBanner();
    }

    function createConsentButton(label, className, clickHandler) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        button.addEventListener("click", clickHandler);
        return button;
    }

    function showConsentBanner() {
        const banner = document.createElement("section");
        banner.className = "analytics-consent";
        banner.setAttribute("aria-label", "Analytics preferences");

        const message = document.createElement("p");
        message.textContent = "Google Analytics helps measure visits and download clicks. No ads tracking.";

        const actions = document.createElement("div");
        actions.className = "analytics-consent-actions";
        actions.append(
            createConsentButton("Allow analytics", "analytics-consent-accept", acceptAnalytics),
            createConsentButton("Decline", "analytics-consent-decline", declineAnalytics),
        );

        banner.append(message, actions);
        document.body.append(banner);
    }

    function initializeAnalytics() {
        attachLinkTracking();
        if (!hasValidMeasurementId() || hasDoNotTrackEnabled()) return;

        const storedConsent = getStoredConsent();
        if (storedConsent === consentAcceptedValue) {
            loadAnalytics();
            return;
        }
        if (storedConsent !== consentDeclinedValue) showConsentBanner();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAnalytics);
    } else {
        initializeAnalytics();
    }
})();
