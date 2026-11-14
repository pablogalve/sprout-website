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
    const sourceQueryParameter = "utm_source";
    const socialSources = ["tiktok", "instagram", "youtube"];
    const aiAssistantHosts = ["chatgpt.com", "chat.openai.com", "perplexity.ai", "claude.ai", "gemini.google.com", "copilot.microsoft.com"];
    const searchEngineHostPattern = /(^|\.)(google|bing|duckduckgo|ecosia|yahoo|brave|yandex|qwant|startpage)\.[a-z.]+$/;
    const TrafficMedium = Object.freeze({
        ai: "ai",
        organic: "organic",
        referral: "referral",
        social: "social",
        website: "website",
    });
    const websiteTrafficSource = "the-sprout.app";
    const trafficSourceSessionStorageKey = "sproutWebsiteTrafficSource";
    const storeLinkSelector = "[data-analytics-store]";
    const playStoreHost = "play.google.com";
    const invitePageName = "invite";

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

    function hostWithoutWww(host) {
        return host.replace(/^www\./, "");
    }

    function mediumForSource(source) {
        if (socialSources.includes(source)) return TrafficMedium.social;
        if (aiAssistantHosts.includes(source)) return TrafficMedium.ai;
        if (searchEngineHostPattern.test(source)) return TrafficMedium.organic;
        return TrafficMedium.referral;
    }

    function externalReferrerHost() {
        try {
            const referrer = new URL(document.referrer);
            if (referrer.origin === window.location.origin) return null;
            return hostWithoutWww(referrer.host);
        } catch (_) {
            return null;
        }
    }

    // ChatGPT tags the links it cites with utm_source=chatgpt.com, and that tag
    // still arrives when the browser strips the referrer.
    function arrivalTrafficSource() {
        const source = new URLSearchParams(window.location.search).get(sourceQueryParameter) || externalReferrerHost();
        if (source) return { source, medium: mediumForSource(source), landingPage: analyticsPageName() };
        return { source: websiteTrafficSource, medium: TrafficMedium.website, landingPage: analyticsPageName() };
    }

    // The first page of a visit decides the source: by the time someone taps a
    // store button on a second page, document.referrer is our own site.
    function resolveTrafficSource() {
        try {
            const storedTrafficSource = window.sessionStorage.getItem(trafficSourceSessionStorageKey);
            if (storedTrafficSource) return JSON.parse(storedTrafficSource);
            const trafficSource = arrivalTrafficSource();
            window.sessionStorage.setItem(trafficSourceSessionStorageKey, JSON.stringify(trafficSource));
            return trafficSource;
        } catch (_) {
            return arrivalTrafficSource();
        }
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
            analytics_storage: "granted",
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

    function trackVisit(trafficSource) {
        if (!shouldTrackVisit()) return;
        trackEvent("website_visit", {
            landing_page: analyticsPageName(),
            page_location: sanitizedLocation(),
            page_path: window.location.pathname,
            page_title: document.title,
            traffic_medium: trafficSource.medium,
            traffic_source: trafficSource.source,
        });
    }

    function trackInvitePageView() {
        trackEvent("invite_page_view", {
            has_referral_code: document.body.dataset.analyticsHasReferralCode,
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
        if (pageName === invitePageName) trackInvitePageView();
    }

    function loadAnalytics(trafficSource) {
        if (window.sproutAnalyticsLoaded) return;
        configureAnalytics();
        const script = document.createElement("script");
        script.async = true;
        script.src = `${analyticsScriptBaseUrl}${encodeURIComponent(measurementId)}`;
        document.head.append(script);
        window.sproutAnalyticsLoaded = true;
        trackVisit(trafficSource);
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

    // Play hands the referrer to Firebase on first open, which is the only way an
    // install from the website reaches GA4 with its source. Tagging happens on tap
    // because the invite page writes its referral code into the link after load.
    function tagStoreLinkWithTrafficSource(link, trafficSource) {
        link.dataset.analyticsTrafficSource = trafficSource.source;
        link.dataset.analyticsTrafficMedium = trafficSource.medium;
        const url = new URL(link.href);
        if (url.host !== playStoreHost) return;
        const playReferrer = new URLSearchParams(url.searchParams.get("referrer") || "");
        playReferrer.set("utm_source", trafficSource.source);
        playReferrer.set("utm_medium", trafficSource.medium);
        playReferrer.set("utm_campaign", trafficSource.landingPage);
        url.searchParams.set("referrer", playReferrer.toString());
        link.href = url.toString();
    }

    function attachStoreLinkTagging(trafficSource) {
        document.querySelectorAll(storeLinkSelector).forEach((link) => {
            link.addEventListener("click", () => tagStoreLinkWithTrafficSource(link, trafficSource));
        });
    }

    function initializeAnalytics() {
        const trafficSource = resolveTrafficSource();
        attachStoreLinkTagging(trafficSource);
        attachLinkTracking();
        if (!hasValidMeasurementId() || hasDoNotTrackEnabled()) return;
        loadAnalytics(trafficSource);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAnalytics);
    } else {
        initializeAnalytics();
    }
})();
