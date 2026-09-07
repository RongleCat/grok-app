(function () {
  try {
    var key = __URL__;
    var jobs = window.__GROK_APP_ALBUM_THUMB_JOBS__;
    var job = jobs && jobs[key];
    if (!job) return JSON.stringify({ state: "error" });
    var result = JSON.stringify(job);
    if (__REMOVE__) {
      try { if (job.controller) job.controller.abort(); } catch (_) {}
      delete jobs[key];
    }
    return result;
  } catch (_) {
    return JSON.stringify({ state: "error" });
  }
})()
