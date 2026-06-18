const titleElement = document.getElementById("page-title");
const urlElement = document.getElementById("page-url");
const emptyStateBannerElement = document.getElementById("empty-state-banner");
const primaryActionElement = document.getElementById("primary-action");
const openNewestButton = document.getElementById("open-newest-button");
const versionsElement = document.getElementById("versions");
const statusElement = document.getElementById("status");

const archiveHosts = [
    "https://archive.is",
    "https://archive.today",
    "https://archive.ph",
    "https://archive.vn",
    "https://archive.fo",
    "https://archive.li",
    "https://archive.md"
];

const archiveHostnames = new Set(archiveHosts.map((host) => new URL(host).hostname));
const requestTimeoutMilliseconds = 8000;

function setStatus(message) {
    statusElement.textContent = message;
}

function setEmptyState(isVisible, message = "No archived version found for this page.") {
    emptyStateBannerElement.hidden = !isVisible;
    emptyStateBannerElement.textContent = message;
}

function isLookupArchiveUrl(archiveUrl, originalUrl) {
    try {
        const parsedArchiveUrl = new URL(archiveUrl);
        const parsedOriginalUrl = new URL(originalUrl);
        const hostname = parsedArchiveUrl.hostname;

        if (!archiveHostnames.has(hostname)) {
            return false;
        }

        if (parsedArchiveUrl.pathname.startsWith("/timegate/") || parsedArchiveUrl.pathname.startsWith("/timemap/")) {
            return true;
        }

        const path = parsedArchiveUrl.pathname.replace(/^\/+/, "");
        const decodedPath = decodeURIComponent(path);
        return decodedPath === parsedOriginalUrl.toString();
    } catch {
        return false;
    }
}

function isDirectSnapshotUrl(archiveUrl, originalUrl) {
    if (isLookupArchiveUrl(archiveUrl, originalUrl)) {
        return false;
    }

    try {
        const parsedArchiveUrl = new URL(archiveUrl);
        const path = parsedArchiveUrl.pathname;
        return /^\/[A-Za-z0-9]{5,}$/.test(path) || /^\/\d{4}/.test(path);
    } catch {
        return false;
    }
}

function extractSnapshotCandidates(html, originalUrl) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const candidates = [];
    const seen = new Set();

    for (const anchor of anchors) {
        const href = anchor.getAttribute("href");
        if (!href) {
            continue;
        }

        const candidateUrl = new URL(href, "https://archive.is").toString();
        if (!isDirectSnapshotUrl(candidateUrl, originalUrl) || seen.has(candidateUrl)) {
            continue;
        }

        seen.add(candidateUrl);
        candidates.push({
            archiveUrl: candidateUrl,
            text: anchor.textContent?.trim() || "",
            context: anchor.parentElement?.textContent?.trim() || ""
        });
    }

    return candidates;
}

async function resolveArchiveUrl(version, originalUrl) {
    if (!isLookupArchiveUrl(version.archiveUrl, originalUrl)) {
        return version.archiveUrl;
    }

    const lookupUrl = `https://archive.is/${encodeURIComponent(originalUrl)}`;
    const response = await fetchWithTimeout(lookupUrl);
    if (!response.ok) {
        return version.archiveUrl;
    }

    const html = await response.text();
    const candidates = extractSnapshotCandidates(html, originalUrl);
    if (candidates.length === 0) {
        return version.archiveUrl;
    }

    const matchingCandidate = candidates.find((candidate) =>
        candidate.text === version.dateLabel ||
        candidate.context.includes(version.dateLabel)
    );

    return matchingCandidate?.archiveUrl || candidates[0].archiveUrl;
}

function setPrimaryVersion(version) {
    if (!version) {
        primaryActionElement.hidden = true;
        openNewestButton.onclick = null;
        return;
    }

    primaryActionElement.hidden = false;
    openNewestButton.onclick = async () => {
        const resolvedArchiveUrl = await resolveArchiveUrl(version, urlElement.textContent);
        await browser.tabs.create({ url: resolvedArchiveUrl });
    };
}

function clearVersions() {
    versionsElement.replaceChildren();
}

function formatGroupLabel(version) {
    if (!version.datetime) {
        return "Archived Versions";
    }

    const date = new Date(version.datetime);
    if (Number.isNaN(date.getTime())) {
        return "Archived Versions";
    }

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function formatVersionLabel(version) {
    if (!version.datetime) {
        return version.dateLabel;
    }

    const date = new Date(version.datetime);
    if (Number.isNaN(date.getTime())) {
        return version.dateLabel;
    }

    return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
    });
}

function renderVersions(versions, originalUrl) {
    clearVersions();
    setPrimaryVersion(versions[0]);

    const groupedVersions = new Map();

    for (const version of versions) {
        const groupLabel = formatGroupLabel(version);
        if (!groupedVersions.has(groupLabel)) {
            groupedVersions.set(groupLabel, []);
        }
        groupedVersions.get(groupLabel).push(version);
    }

    for (const [groupLabel, grouped] of groupedVersions.entries()) {
        const groupSection = document.createElement("section");
        const heading = document.createElement("p");
        const list = document.createElement("ul");

        groupSection.className = "version-group";
        heading.className = "group-label";
        heading.textContent = groupLabel;
        list.className = "version-list";

        for (const version of grouped) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            const label = document.createElement("span");
            const note = document.createElement("small");

            button.className = "version-button";
            button.type = "button";
            label.className = "version-label";
            label.textContent = formatVersionLabel(version);
            note.textContent = version.archiveUrl;
            button.append(label, note);

            button.addEventListener("click", async () => {
                const resolvedArchiveUrl = await resolveArchiveUrl(version, originalUrl);
                await browser.tabs.create({ url: resolvedArchiveUrl });
            });

            item.append(button);
            list.append(item);
        }

        groupSection.append(heading, list);
        versionsElement.append(groupSection);
    }
}

async function getActiveTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}

function isArchiveHost(urlString) {
    try {
        return archiveHostnames.has(new URL(urlString).hostname);
    } catch {
        return false;
    }
}

function buildArchiveLookupUrls(pageUrl) {
    const encodedUrl = encodeURIComponent(pageUrl);
    return archiveHosts.map((host) => ({
        timemapUrl: `${host}/timemap/${encodedUrl}`,
        fallbackListUrl: `${host}/${encodedUrl}`
    }));
}

async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMilliseconds);

    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchOptionalArchiveResource(url) {
    const response = await fetchWithTimeout(url);
    if (response.ok) {
        return response;
    }

    if (response.status === 404) {
        return null;
    }

    throw new Error(`archive.is returned HTTP ${response.status}.`);
}

function parseTimeMap(text) {
    const results = [];
    const seen = new Set();
    const regex = /<([^>]+)>;\s*rel="memento"(?:[^,]*?\sdatetime="([^"]+)")?/g;

    for (const match of text.matchAll(regex)) {
        const archiveUrl = match[1];
        const datetime = match[2] || "";
        if (seen.has(archiveUrl)) {
            continue;
        }
        seen.add(archiveUrl);

        results.push({
            archiveUrl,
            datetime,
            dateLabel: datetime ? new Date(datetime).toLocaleString() : archiveUrl
        });
    }

    return results.sort((left, right) => {
        const leftTime = Date.parse(left.datetime || "") || 0;
        const rightTime = Date.parse(right.datetime || "") || 0;
        return rightTime - leftTime;
    });
}

function parseArchiveListHtml(html, pageUrl) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const versions = [];
    const seen = new Set();

    for (const anchor of anchors) {
        const href = anchor.getAttribute("href");
        if (!href) {
            continue;
        }

        const archiveUrl = new URL(href, "https://archive.is").toString();
        const hostname = new URL(archiveUrl).hostname;
        if (!archiveHostnames.has(hostname)) {
            continue;
        }

        const text = anchor.textContent?.trim() || "";
        const mentionsOriginalUrl = anchor.parentElement?.textContent?.includes(pageUrl);
        const looksLikeSnapshot = /^\d{1,2}\s\w{3}\s\d{4}/.test(text) || archiveUrl.includes("/20");
        if (!looksLikeSnapshot || !mentionsOriginalUrl || seen.has(archiveUrl)) {
            continue;
        }

        seen.add(archiveUrl);
        versions.push({
            archiveUrl,
            datetime: text,
            dateLabel: text
        });
    }

    return versions.sort((left, right) => {
        const leftTime = Date.parse(left.datetime || "") || 0;
        const rightTime = Date.parse(right.datetime || "") || 0;
        return rightTime - leftTime;
    });
}

async function fetchVersions(pageUrl) {
    const lookupUrls = buildArchiveLookupUrls(pageUrl);
    let lastError = null;
    let receivedSuccessfulResponse = false;

    for (const lookup of lookupUrls) {
        try {
            const timeMapResponse = await fetchOptionalArchiveResource(lookup.timemapUrl);
            if (timeMapResponse) {
                receivedSuccessfulResponse = true;
                const timeMapText = await timeMapResponse.text();
                const versions = parseTimeMap(timeMapText);
                const directVersions = versions.filter((version) => !isLookupArchiveUrl(version.archiveUrl, pageUrl));
                if (directVersions.length > 0) {
                    return directVersions;
                }
                if (versions.length > 0) {
                    return versions;
                }
            }
        } catch (error) {
            lastError = error;
        }

        try {
            const listResponse = await fetchOptionalArchiveResource(lookup.fallbackListUrl);
            if (listResponse) {
                receivedSuccessfulResponse = true;
                const html = await listResponse.text();
                const versions = parseArchiveListHtml(html, pageUrl);
                if (versions.length > 0) {
                    return versions;
                }
            }
        } catch (error) {
            lastError = error;
        }
    }

    if (!receivedSuccessfulResponse && lastError) {
        throw lastError;
    }

    return [];
}

async function loadVersions() {
    try {
        const activeTab = await getActiveTab();
        const rawPageUrl = activeTab?.url;
        if (!rawPageUrl || !/^https?:/.test(rawPageUrl)) {
            throw new Error("Open a normal http(s) page, then reopen the extension.");
        }

        if (isArchiveHost(rawPageUrl)) {
            throw new Error("Open the original page, not an archive.is page.");
        }

        const normalizedUrl = new URL(rawPageUrl);
        normalizedUrl.hash = "";
        const pageUrl = normalizedUrl.toString();

        titleElement.textContent = activeTab.title || "Current Page";
        urlElement.textContent = pageUrl;

        const versions = await fetchVersions(pageUrl);
        if (versions.length === 0) {
            titleElement.textContent = "No archive found";
            setEmptyState(true);
            setStatus("archive.is has no saved versions for this exact URL.");
            setPrimaryVersion(null);
            clearVersions();
            return;
        }

        setEmptyState(false);
        titleElement.textContent = `${versions.length} archived version${versions.length === 1 ? "" : "s"}`;
        setStatus("Open the newest archive directly or pick a specific capture.");
        renderVersions(versions, pageUrl);
    } catch (error) {
        titleElement.textContent = "Lookup failed";
        setEmptyState(false);
        setPrimaryVersion(null);
        clearVersions();
        setStatus(error.name === "AbortError" ? "archive.is did not respond in time." : error.message || "archive.is lookup failed.");
    }
}

loadVersions();
