
define("cpo/http-imports", [], function() {
  function moduleURL(args) {
    if (args.length !== 1) throw new Error("js-http expects one absolute HTTP(S) URL");
    const url = new URL(args[0]);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("js-http expects an HTTP(S) URL");
    }
    return url.href;
  }

  function makeJSHTTPLocator(url, runtime, builtinModules, cpo) {
    const field = (mod, name) => runtime.getField(runtime.getField(mod, "values"), name);
    // Resume onto the Pyret stack before inspecting the native module: parsing
    // provides and dependencies can raise Pyret exceptions or suspend.
    return runtime.safeCall(function() {
      return runtime.pauseStack(function(restarter) {
        fetch(url, { credentials: "omit" }).then(function(response) {
          if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);
          return response.text();
        }).then(function(contents) {
          restarter.resume(contents);
        }, function(error) {
          restarter.error(runtime.ffi.makeMessageException("Could not load JavaScript module " + url + ": " + error.message));
        });
      });
    }, function(contents) {
      return runtime.safeCall(function() {
        return field(builtinModules, "builtin-raw-locator-from-str").app(contents);
      }, function(raw) {
        return field(cpo, "make-js-locator-from-raw").app(raw, true, "js-http://" + url, url);
      }, "js-http:make-locator");
    }, "js-http:fetch");
  }

  return { moduleURL: moduleURL, makeJSHTTPLocator: makeJSHTTPLocator };
});
