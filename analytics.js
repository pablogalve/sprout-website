(function () {
    const config = window.sproutAnalyticsConfig || {};
    const measurementId = config.ga4MeasurementId || "";
    const measurementIdPattern = /^G-[A-Z0-9]+$/;
    const visitSessionStorageKey = "sproutWebsiteVisitTracked";
    const visitSessionStorageValue = "true";
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

    function initializeDataLayer() {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag() {
            window.dataLayer.push(arguments);
        };
    }

    function sanitizedLocation() {
        return `${window.location.origin}${window.location.pathname}`;
    }

    function sanitizedHref(href) {
        try {
            const url = new URL(href, window.location.href);
            return `${url.origin}${url.pathname}`;
        } catch (_) {
            return href;
        }
    }

    function analyticsPageName() {
        return document.body.dataset.analyticsPage || "unknown";
    }

    function shouldTrackVisit() {
        try {
            if (window.sessionStorage.getItem(visitSessionStorageKey) === visitSessionStorageValue) return false;
            window.sessionStorage.setItem(visitSessionStorageKey, visitSessionStorageValue);
            return true;
        } catch (_) {
            return true;
        }
    }

    function configureAnalytics() {
        initializeDataLayer();
        window.gtag("consent", "default", {
            ad_personalization: "denied",
            ad_storage: "denied",
            ad_user_data: "denied",
            analytics_storage: "denied",
        });
        window.gtag("set", "ads_data_redaction", true);
        window.gtag("js", new Date());
        window.gtag("config", measurementId, {
            allow_ad_personalization_signals: false,
            allow_google_signals: false,
            client_storage: "none",
            page_location: sanitizedLocation(),
            page_path: window.location.pathname,
            page_title: document.title,
        });
    }

    function trackEvent(name, parameters) {
        if (!window.gtag) return;
        window.gtag("event", name, {
            transport_type: "beacon",
            ...parameters,
        });
    }

    function trackVisit() {
        if (!shouldTrackVisit()) return;
        trackEvent("website_visit", {
            landing_page: analyticsPageName(),
            page_location: sanitizedLocation(),
            page_path: window.location.pathname,
            page_title: document.title,
        });
    }

    function trackPageView() {
        const pageName = analyticsPageName();
        if (!pageName) return;
        trackEvent("website_page_view", {
            page_location: sanitizedLocation(),
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
        trackVisit();
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
            link_url: sanitizedHref(link.href),
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

    function initializeAnalytics() {
        attachLinkTracking();
        if (!hasValidMeasurementId() || hasDoNotTrackEnabled()) return;
        loadAnalytics();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAnalytics);
    } else {
        initializeAnalytics();
    }
})();
