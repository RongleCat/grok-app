(function () {
  try {
    var url = __URL__;
    var key = url;
    var jobs = window.__GROK_APP_ALBUM_THUMB_JOBS__ ||
      (window.__GROK_APP_ALBUM_THUMB_JOBS__ = Object.create(null));
    if (jobs[key] && jobs[key].state === "loading") {
      return JSON.stringify({ state: "loading" });
    }
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    jobs[key] = { state: "loading", controller: controller };
    var timer = window.setTimeout(function () {
      try { if (controller) controller.abort(); } catch (_) {}
    }, 12000);

    function fail() {
      window.clearTimeout(timer);
      jobs[key] = { state: "error" };
    }

    function dimensionsAreSafe(width, height) {
      return Number.isFinite(width) && Number.isFinite(height) &&
        width > 0 && height > 0 &&
        width <= __MAX_DIMENSION__ && height <= __MAX_DIMENSION__ &&
        width * height <= __MAX_PIXELS__;
    }

    function dimensionsFromHeader(buffer) {
      var bytes = new Uint8Array(buffer);
      var length = bytes.length;
      if (length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
          bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
          bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        var pngWidth = ((bytes[16] * 0x1000000) + (bytes[17] << 16) +
          (bytes[18] << 8) + bytes[19]) >>> 0;
        var pngHeight = ((bytes[20] * 0x1000000) + (bytes[21] << 16) +
          (bytes[22] << 8) + bytes[23]) >>> 0;
        return [pngWidth, pngHeight];
      }
      if (length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 &&
          bytes[2] === 0x46 && bytes[3] === 0x38 &&
          (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return [bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8)];
      }
      if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
      var cursor = 2;
      while (cursor + 3 < length) {
        while (cursor < length && bytes[cursor] !== 0xff) cursor += 1;
        while (cursor < length && bytes[cursor] === 0xff) cursor += 1;
        if (cursor >= length) return null;
        var marker = bytes[cursor++];
        if (marker === 0xd8 || marker === 0xd9 ||
            (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (cursor + 1 >= length) return null;
        var segmentLength = (bytes[cursor] << 8) | bytes[cursor + 1];
        if (segmentLength < 2 || cursor + segmentLength > length) return null;
        var isStartOfFrame = marker === 0xc0 || marker === 0xc1 ||
          marker === 0xc2 || marker === 0xc3 || marker === 0xc5 ||
          marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
          marker === 0xca || marker === 0xcb || marker === 0xcd ||
          marker === 0xce || marker === 0xcf;
        if (isStartOfFrame && segmentLength >= 7) {
          return [
            (bytes[cursor + 5] << 8) | bytes[cursor + 6],
            (bytes[cursor + 3] << 8) | bytes[cursor + 4]
          ];
        }
        cursor += segmentLength;
      }
      return null;
    }

    function encode(source, width, height) {
      try {
        if (!dimensionsAreSafe(width, height)) return fail();
        var scale = Math.min(1, 480 / Math.max(width, height));
        var outWidth = Math.max(1, Math.round(width * scale));
        var outHeight = Math.max(1, Math.round(height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = outWidth;
        canvas.height = outHeight;
        var context = canvas.getContext("2d", { alpha: false });
        if (!context) return fail();
        context.drawImage(source, 0, 0, outWidth, outHeight);
        var dataUrl = canvas.toDataURL("image/jpeg", 0.78);
        window.clearTimeout(timer);
        if (!dataUrl || dataUrl.indexOf("data:image/jpeg;base64,") !== 0 ||
            dataUrl.length > __MAX_DATA_URL__) return fail();
        jobs[key] = {
          state: "ready",
          dataUrl: dataUrl,
          width: width,
          height: height
        };
      } catch (_) {
        fail();
      }
    }

    fetch(url, {
      credentials: "include",
      mode: "cors",
      cache: "force-cache",
      redirect: "follow",
      signal: controller ? controller.signal : undefined
    })
      .then(function (response) {
        if (!response.ok) throw new Error("status");
        var finalUrl = new URL(response.url || url, location.href);
        if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "assets.grok.com" ||
            (finalUrl.port && finalUrl.port !== "443") || finalUrl.username ||
            finalUrl.password || finalUrl.pathname.indexOf("/generated/") < 0) {
          throw new Error("redirect");
        }
        var type = String(response.headers.get("content-type") || "").toLowerCase();
        var length = Number(response.headers.get("content-length") || 0);
        if (type.indexOf("image/") !== 0 || length > __MAX_SOURCE_BYTES__) {
          throw new Error("type");
        }
        return response.blob();
      })
      .then(function (blob) {
        if (!blob || !blob.size || blob.size > __MAX_SOURCE_BYTES__) {
          throw new Error("size");
        }
        return blob.slice(0, __MAX_HEADER_BYTES__).arrayBuffer().then(function (buffer) {
          var dimensions = dimensionsFromHeader(buffer);
          if (!dimensions || !dimensionsAreSafe(dimensions[0], dimensions[1])) {
            throw new Error("dimensions");
          }
          return { blob: blob, width: dimensions[0], height: dimensions[1] };
        });
      })
      .then(function (payload) {
        if (typeof createImageBitmap === "function") {
          return createImageBitmap(payload.blob).then(function (bitmap) {
            if (bitmap.width !== payload.width || bitmap.height !== payload.height) {
              try { bitmap.close(); } catch (_) {}
              throw new Error("dimensions");
            }
            encode(bitmap, bitmap.width, bitmap.height);
            try { bitmap.close(); } catch (_) {}
          });
        }
        return new Promise(function (resolve, reject) {
          var objectUrl = URL.createObjectURL(payload.blob);
          var image = new Image();
          image.onload = function () {
            try {
              if (image.naturalWidth !== payload.width ||
                  image.naturalHeight !== payload.height) {
                reject(new Error("dimensions"));
                return;
              }
              encode(image, image.naturalWidth, image.naturalHeight);
              resolve();
            } finally {
              URL.revokeObjectURL(objectUrl);
            }
          };
          image.onerror = function () {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("decode"));
          };
          image.src = objectUrl;
        });
      })
      .catch(fail);
    return JSON.stringify({ state: "loading" });
  } catch (_) {
    return JSON.stringify({ state: "error" });
  }
})()
