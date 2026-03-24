const IDENTIFYING_PARAMS = [
  "jk", "vjk", "jobid", "job_id", "jid", "gh_jid", "ashby_jid",
  "requisitionid", "requisition_id", "reqid", "id", "posting_id", "req_id",
];

export function getJobDedupKey(url: string): string {
  const raw = url.trim().toLowerCase();
  if (!raw) return "";

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = parsed.pathname.toLowerCase().replace(/\/+$/, "");

    path = path
      .replace(/\/job-opening\//, "/job-openings/")
      .replace(/\/jobs\/search$/, "/jobs")
      .replace(/\/+/g, "/");

    if (hostname.includes("indeed")) {
      const indeedJobKey =
        parsed.searchParams.get("jk") ?? parsed.searchParams.get("vjk");
      if (indeedJobKey) {
        return `indeed:jk:${indeedJobKey.toLowerCase()}`;
      }
      if (
        path.includes("/viewjob") ||
        path.includes("/rc/clk") ||
        path.includes("/pagead/clk")
      ) {
        return `${hostname}${path}`;
      }
    }

    if (hostname.includes("ziprecruiter")) {
      const jid = parsed.searchParams.get("jid");
      if (jid) return `ziprecruiter:jid:${jid.toLowerCase()}`;
      if (
        path.startsWith("/c/") ||
        path.startsWith("/k/") ||
        path.includes("/job-details/")
      ) {
        return `${hostname}${path}`;
      }
      const lk = parsed.searchParams.get("lk");
      if (lk) return `ziprecruiter:lk:${lk.toLowerCase()}`;
      return `${hostname}${path}`;
    }

    if (hostname.includes("dice")) {
      const pathParts = path.split("/").filter(Boolean);
      const m1 = path.match(/\/job-detail\/([a-f0-9-]{8,})/i);
      if (m1) return `dice:job:${m1[1].toLowerCase()}`;
      const m2 = path.match(/\/jobs\/detail\/([a-f0-9-]{8,})/i);
      if (m2) return `dice:job:${m2[1].toLowerCase()}`;
      const m3 = path.match(/\/([a-f0-9]{24,})/i);
      if (m3) return `dice:job:${m3[1].toLowerCase()}`;

      if (pathParts[0] === "job-detail" && pathParts.length >= 2) {
        const detailId = pathParts[pathParts.length - 1];
        if (detailId && detailId.length >= 8) {
          return `dice:job:${detailId.toLowerCase()}`;
        }
        return `dice:path:${path}`;
      }

      if (pathParts[0] === "jobs" && pathParts[1] === "detail" && pathParts.length >= 3) {
        const detailId = pathParts[pathParts.length - 1];
        if (detailId && detailId.length >= 8) {
          return `dice:job:${detailId.toLowerCase()}`;
        }
        return `dice:path:${path}`;
      }
    }

    if (hostname.includes("monster")) {
      const normalizedPath = path.replace(/\/job-opening\//, "/job-openings/");
      const jobId = parsed.searchParams.get("jobid") ?? parsed.searchParams.get("job_id");
      if (jobId) {
        return `${hostname}${normalizedPath}?jobid=${jobId.toLowerCase()}`;
      }
      return `${hostname}${normalizedPath}`;
    }

    if (hostname.includes("glassdoor")) {
      const jobListingId =
        parsed.searchParams.get("jl") ??
        parsed.searchParams.get("jobListingId") ??
        parsed.searchParams.get("joblistingid");
      if (jobListingId) {
        return `glassdoor:jl:${jobListingId.toLowerCase()}`;
      }

      if (
        path.includes("/job-listing/") ||
        path.includes("/partner/joblisting.htm")
      ) {
        return `${hostname}${path}`;
      }
    }

    if (hostname === "builtin.com" || hostname.endsWith(".builtin.com")) {
      const pathParts = path.split("/").filter(Boolean);
      if (pathParts[0] === "job" && pathParts.length >= 2) {
        const builtInJobId = pathParts[pathParts.length - 1];
        if (/^\d+$/.test(builtInJobId)) {
          return `builtin:job:${builtInJobId}`;
        }
      }
    }

    for (const param of IDENTIFYING_PARAMS) {
      const value = parsed.searchParams.get(param);
      if (value) {
        return `${hostname}${path}?${param}=${value.toLowerCase()}`;
      }
    }

    return `${hostname}${path}`;
  } catch {
    return raw;
  }
}

export function getSpawnDedupKey(url: string): string {
  const raw = url.trim().toLowerCase();
  if (!raw) return "";

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "").replace(/\/+/g, "/");
    const search = parsed.search.toLowerCase();
    return `${hostname}${path}${search}`;
  } catch {
    return raw;
  }
}
