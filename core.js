// Capture format and GitHub client shared with the desktop extension.
export function normalizeSettings(input) {
  let repository = String(input.repository || "").trim().replace(/\/$/, "");
  if (repository.startsWith("https://github.com/")) {
    const url = new URL(repository);
    if (url.search || url.hash) throw new Error("Use the repository's main URL, without a query or fragment.");
    repository = url.pathname.slice(1).replace(/\/$/, "");
  }
  repository = repository.replace(/\.git$/, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    throw new Error("Enter a repository as owner/repo or https://github.com/owner/repo.");
  }
  const token = String(input.token || "").trim();
  if (!token || /\s/.test(token)) throw new Error("Enter your GitHub access token.");
  const folder = String(input.folder ?? "inbox").trim().replace(/^\/+|\/+$/g, "");
  if (!folder || folder.length > 160 || folder.split("/").some(part => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part))) {
    throw new Error("Use a folder such as inbox or notes/inbox, without spaces or dot-only path segments.");
  }
  return { repository, token, folder };
}

export function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function timestampUrl(source, seconds) {
  const safe = safeWebUrl(source);
  if (!safe || !Number.isFinite(seconds) || seconds < 0) return safe;
  const url = new URL(safe);
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) {
    url.searchParams.delete("start");
    url.searchParams.set("t", `${Math.floor(seconds)}s`);
  }
  return url.href;
}

export function displayTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60];
  return parts[0] ? `${parts[0]}:${String(parts[1]).padStart(2, "0")}:${String(parts[2]).padStart(2, "0")}` : `${parts[1]}:${String(parts[2]).padStart(2, "0")}`;
}

export function createCapture(input, settings, now = new Date(), id = crypto.randomUUID()) {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) throw new Error("Invalid capture ID.");
  const kind = ["note", "task", "idea"].includes(input.kind) ? input.kind : "note";
  const text = String(input.text || "").trim();
  const includeSource = input.includeSource !== false;
  const source = includeSource ? safeWebUrl(input.source) : "";
  const quote = includeSource ? String(input.quote || "").trim() : "";
  if (!text && !source && !quote) throw new Error("Write a thought or include a page to save.");
  if (kind === "task" && !text) throw new Error("Write the task you want to remember.");
  if (text.length > 50000 || quote.length > 50000) throw new Error("Keep each note and selection below 50,000 characters.");
  const titleInput = includeSource && source ? input.title : text.split("\n")[0];
  const title = String(titleInput || "Quick capture").replace(/[\r\n\t]+/g, " ").trim().slice(0, 250) || "Quick capture";
  const seconds = includeSource && Number.isFinite(input.seconds) && input.seconds >= 0 ? Math.floor(input.seconds) : null;
  const pad = number => String(number).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return {
    id, kind, text, source: timestampUrl(source, seconds), quote, title, seconds,
    created: now.toISOString(), day,
    repository: settings.repository,
    path: `${settings.folder}/${day}/${clock}-${id}.md`
  };
}

export function markdown(capture) {
  const frontmatter = ["---", `id: ${JSON.stringify(capture.id)}`, `created: ${JSON.stringify(capture.created)}`, `type: ${capture.kind}`];
  if (capture.source) frontmatter.push(`source: ${JSON.stringify(capture.source)}`);
  const title = capture.title.replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
  const lines = [...frontmatter, "---", "", `# ${title}`, ""];
  if (capture.text) {
    lines.push(capture.kind === "task" ? `- [ ] ${capture.text.replace(/\n/g, "\n      ")}` : capture.text, "");
  }
  if (capture.quote) lines.push("## Selected passage", "", ...capture.quote.split("\n").map(line => `> ${line}`), "");
  if (capture.source) {
    lines.push(`Source: <${capture.source.replace(/</g, "%3C").replace(/>/g, "%3E")}>`);
    if (capture.seconds !== null) lines.push(`Video position: ${displayTime(capture.seconds)}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value) {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, "")), char => char.charCodeAt(0)));
}

export function repoApiPath(repository) {
  return `/repos/${repository.split("/").map(encodeURIComponent).join("/")}`;
}

export class GitHubError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export async function github(settings, path, init = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${settings.token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        ...(init.body ? { "Content-Type": "application/json" } : {})
      },
      signal: AbortSignal.timeout(20000),
      credentials: "omit", redirect: "error", cache: "no-store"
    });
  } catch { throw new GitHubError("Couldn't reach GitHub. Your capture is kept on this device; retry when you're online."); }
  if (!response.ok) {
    const messages = {
      401: "GitHub rejected the token. Replace it in Settings if it has expired.",
      403: "GitHub denied this request. Check token Contents permissions, organization approval, branch rules, or API limits.",
      404: "Repository or branch unavailable. Check its name and that your token can access it.",
      409: "GitHub reported a conflict. Your capture is kept locally; try again.",
      422: "GitHub couldn't create the file. Initialize the repository with a README and check branch rules."
    };
    throw new GitHubError(messages[response.status] || `GitHub returned ${response.status}. Your capture is kept locally.`, response.status);
  }
  return response.json();
}

export async function checkRepository(settings, fetcher = fetch) {
  const metadata = await github(settings, repoApiPath(settings.repository), {}, fetcher);
  if (metadata.private !== true || (metadata.visibility && metadata.visibility !== "private")) {
    throw new Error("Choose a private GitHub repository. Repo Notes won't send captures to a public or internal repository.");
  }
  if (metadata.archived || metadata.disabled) throw new Error("This repository is archived or disabled. Choose a writable private repository.");
  return metadata;
}

export async function uploadCapture(capture, settings, fetcher = fetch) {
  if (capture.repository.toLowerCase() !== settings.repository.toLowerCase()) {
    throw new Error(`This pending capture belongs to ${capture.repository}. Reconnect that repository in Settings to send it.`);
  }
  // Check visibility again at send time, including when retrying older captures.
  const metadata = await checkRepository(settings, fetcher);
  const filePath = `${repoApiPath(settings.repository)}/contents/${capture.path.split("/").map(encodeURIComponent).join("/")}`;
  const expected = markdown(capture);
  const branch = metadata.default_branch;
  if (!branch) throw new Error("Initialize the repository with a README, then retry.");
  const resultUrl = `https://github.com/${settings.repository}/blob/${encodeURIComponent(branch)}/${capture.path.split("/").map(encodeURIComponent).join("/")}`;
  // A request may have succeeded before a network interruption. Read first so a retry
  // confirms the same file instead of creating a duplicate or overwriting anything.
  try {
    const existing = await github(settings, `${filePath}?ref=${encodeURIComponent(branch)}`, {}, fetcher);
    if (existing.type === "file" && existing.encoding === "base64" && fromBase64(existing.content || "") === expected) return resultUrl;
    throw new Error("A different file already exists at this capture's path. It was left unchanged; the capture remains on this device.");
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }
  await github(settings, filePath, {
    method: "PUT",
    body: JSON.stringify({ message: `Capture ${capture.kind}: ${capture.title.slice(0, 100)}`, content: toBase64(expected), branch })
  }, fetcher);
  return resultUrl;
}
