({
  requires: [
    { "import-type": "dependency",
      protocol: "js-file",
      args: ["./check-ui"]
    },
    { "import-type": "dependency",
      protocol: "js-file",
      args: ["./output-ui"]
    },
    { "import-type": "dependency",
      protocol: "js-file",
      args: ["./error-ui"]
    },
    { "import-type": "dependency",
      protocol: "js-file",
      args: ["./text-handlers"]
    },
    { "import-type": "builtin",
      name: "world-lib"
    },
    { "import-type": "builtin",
      name: "load-lib"
    }
  ],
  nativeRequires: [
    "pyret-base/js/runtime-util"
  ],
  provides: {},
  theModule: function(runtime, _, uri,
                      checkUI, outputUI, errorUI,
                      textHandlers, worldLib, loadLib,
                      util) {
    var ffi = runtime.ffi;

    var output = jQuery("<div id='output' class='cm-s-default'>");
    output.append($("<p class='examplar_info'>Examplar will run your test cases against a set of correct implementations ('wheats'), then against a small set of buggy ones ('chaffs'). Try to catch as many bugs as you can!<p>"));

    var outputPending = jQuery("<span>").text("Gathering results...");
    var outputPendingHidden = true;
    var canShowRunningIndicator = false;
    var running = false;

    class Graph {
      constructor(value) {
        let xmlns = "http://www.w3.org/2000/svg";
        let svg = document.createElementNS(xmlns, "svg");

        svg.setAttributeNS(null, "viewBox", "0 0 36 36");
        svg.classList.add("circular-chart");
        svg.classList.add("blue");

        let circle = "M18 2.0845 "
                   + "a 15.9155 15.9155 0 0 1 0 31.831 "
                   + "a 15.9155 15.9155 0 0 1 0 -31.831";

        let bg = document.createElementNS(xmlns, "path");
        bg.classList.add("circle-bg");
        bg.setAttributeNS(null, 'd', circle);

        let fg = document.createElementNS(xmlns, "path");
        fg.classList.add("circle");
        fg.setAttributeNS(null, 'd', circle);
        fg.setAttributeNS(null, 'stroke-dasharray', "0, 100");

        let text = document.createElementNS(xmlns, "text");
        text.classList.add("percentage");
        text.setAttributeNS(null, 'x', "18");
        text.setAttributeNS(null, 'y', "20.35");

        this.bg = svg.appendChild(bg);
        this.fg = svg.appendChild(fg);
        this.text = svg.appendChild(text);
        this.element = svg;

        let fallback = {numerator: "none", denominator: "none"};
        this.numerator = (value || fallback).numerator;
        this.denominator = (value || fallback).denominator;
        this.value = {numerator: this.numerator, denominator: this.denominator};
      }

      set value(value){
        if (typeof value.numerator === "number" &&
            typeof value.denominator === "number")
        {
          this.numerator = value.numerator;
          this.denominator = value.denominator;
          this.fg.setAttributeNS(null, 'stroke-dasharray',
            `${(value.numerator / value.denominator) * 100}, 100`);
          this.text.innerHTML = `${value.numerator}⁄${value.denominator}`;
        } else {
          this.fg.setAttributeNS(null, 'stroke-dasharray', "0, 100");
          this.text.innerHTML = "?";
        }
      }
    }

    class StatusWidget {
      constructor() {
        let element = document.createElement('div');
        element.classList.add("examplar_status_widget");

        let wheat_side = document.createElement('div');
        wheat_side.classList.add("examplar_status");
        let wheat_graph = new Graph();
        wheat_side.innerHTML = "Wheats<br>Accepted";
        wheat_side.prepend(wheat_graph.element);

        let chaff_side = document.createElement('div');
        chaff_side.classList.add("examplar_status");
        chaff_side.innerHTML = "Chaffs<br>Rejected";
        let chaff_graph = new Graph();
        chaff_side.prepend(chaff_graph.element);

        this.wheat_side = element.appendChild(wheat_side);
        this.chaff_side = element.appendChild(chaff_side);
        this.element = element;

        this.wheat_graph = wheat_graph;
        this.chaff_graph = chaff_graph;
      }
    }

    var status_widget = new StatusWidget();

    var RUNNING_SPINWHEEL_DELAY_MS = 1000;

    function merge(obj, extension) {
      var newobj = {};
      Object.keys(obj).forEach(function(k) {
        newobj[k] = obj[k];
      });
      Object.keys(extension).forEach(function(k) {
        newobj[k] = extension[k];
      });
      return newobj;
    }
    var animationDivs = [];
    function closeAnimationIfOpen() {
      animationDivs.forEach(function(animationDiv) {
        animationDiv.empty();
        animationDiv.dialog("destroy");
        animationDiv.remove();
      });
      animationDivs = [];
    }
    function closeTopAnimationIfOpen() {
      var animationDiv = animationDivs.pop();
      animationDiv.empty();
      animationDiv.dialog("destroy");
      animationDiv.remove();
    }

    var interactionsCount = 0;

    function formatCode(container, src) {
      CodeMirror.runMode(src, "pyret", container);
    }

    // NOTE(joe): sadly depends on the page and hard to figure out how to make
    // this less global
    function scroll(output) {
      $(".repl").animate({
           scrollTop: output.height(),
         },
         50
      );
    }

    // the result of applying `displayResult` is a function that MUST
    // NOT BE CALLED ON THE PYRET STACK.
    function displayResult(output, callingRuntime, resultRuntime, isMain) {
      var runtime = callingRuntime;
      var rr = resultRuntime;

      // MUST BE CALLED ON THE PYRET STACK
      function renderAndDisplayError(runtime, error, stack, click, result) {
        var error_to_html = errorUI.error_to_html;
        // `renderAndDisplayError` must be called on the pyret stack
        // because of this call to `pauseStack`
        return runtime.pauseStack(function (restarter) {
          // error_to_html must not be called on the pyret stack
          return error_to_html(runtime, CPO.documents, error, stack, result).
            then(function (html) {
              html.on('click', function(){
                $(".highlights-active").removeClass("highlights-active");
                html.trigger('toggleHighlight');
                html.addClass("highlights-active");
              });
              html.addClass('compile-error').appendTo(output);
              if (click) html.click();
            }).done(function () {restarter.resume(runtime.nothing)});
        });
      }

      // this function must NOT be called on the pyret stack
      return function(result) {
        var doneDisplay = Q.defer();
        var didError = false;
        // Start a new pyret stack.
        // this returned function must not be called on the pyret stack
        // b/c `callingRuntime.runThunk` must not be called on the pyret stack
        callingRuntime.runThunk(function() {
          console.log("Full time including compile/load:", JSON.stringify(result.stats));
          if(callingRuntime.isFailureResult(result)) {
            didError = true;
            // Parse Errors
            // `renderAndDisplayError` must be called on the pyret stack
            // this application runs in the context of the above `callingRuntime.runThunk`
            return renderAndDisplayError(callingRuntime, result.exn.exn, undefined, true, result);
          }
          else if(callingRuntime.isSuccessResult(result)) {
            result = result.result;
            return ffi.cases(ffi.isEither, "is-Either", result, {
              left: function(compileResultErrors) {
                closeAnimationIfOpen();
                didError = true;
                // Compile Errors
                var errors = ffi.toArray(compileResultErrors).
                  reduce(function (errors, error) {
                      Array.prototype.push.apply(errors,
                        ffi.toArray(runtime.getField(error, "problems")));
                      return errors;
                    }, []);
                // `safeCall` must be called on the pyret stack
                // this application runs in the context of the above `callingRuntime.runThunk`
                return callingRuntime.safeCall(
                  function() {
                    // eachLoop must be called in the context of the pyret stack
                    // this application runs in the context of the above `callingRuntime.runThunk`
                    return callingRuntime.eachLoop(runtime.makeFunction(function(i) {
                      // `renderAndDisplayError` must be called in the context of the
                      // pyret stack.
                      return renderAndDisplayError(callingRuntime, errors[i], [], true, result);
                    }), 0, errors.length);
                  }, function (result) { return result; }, "renderMultipleErrors");
              },
              right: function(v) {
                // TODO(joe): This is a place to consider which runtime level
                // to use if we have separate compile/run runtimes.  I think
                // that loadLib will be instantiated with callingRuntime, and
                // I think that's correct.
                return callingRuntime.pauseStack(function(restarter) {
                  rr.runThunk(function() {
                    var runResult = rr.getField(loadLib, "internal").getModuleResultResult(v);
                    console.log("Time to run compiled program:", JSON.stringify(runResult.stats));
                    if(rr.isSuccessResult(runResult)) {
                      return rr.safeCall(function() {
                        return checkUI.drawCheckResults(output, CPO.documents, rr,
                                                        runtime.getField(runResult.result, "checks"), v);
                      }, function(_) {
                        outputPending.remove();
                        outputPendingHidden = true;
                        return true;
                      }, "rr.drawCheckResults");
                    } else {
                      didError = true;
                      // `renderAndDisplayError` must be called in the context of the pyret stack.
                      // this application runs in the context of the above `rr.runThunk`.
                      return renderAndDisplayError(resultRuntime, runResult.exn.exn,
                                                   runResult.exn.pyretStack, true, runResult);
                    }
                  }, function(_) {
                    restarter.resume(callingRuntime.nothing);
                  });
                });
              }
            });
          }
          else {
            doneDisplay.reject("Error displaying output");
            console.error("Bad result: ", result);
            didError = true;
            // `renderAndDisplayError` must be called in the context of the pyret stack.
            // this application runs in the context of `callingRuntime.runThunk`
            return renderAndDisplayError(
              callingRuntime,
              ffi.InternalError("Got something other than a Pyret result when running the program.",
                                ffi.makeList(result)));
          }
        }, function(_) {
          if (didError) {
            var snippets = output.find(".CodeMirror");
            for (var i = 0; i < snippets.length; i++) {
              snippets[i].CodeMirror.refresh();
            }
          }
          doneDisplay.resolve("Done displaying output");
          return callingRuntime.nothing;
        });
      return doneDisplay.promise;
      }
    }

    // the result of applying `displayResult` is a function that MUST
    // NOT BE CALLED ON THE PYRET STACK.
    function jsonResult(output, callingRuntime, resultRuntime, isMain) {
      var runtime = callingRuntime;
      var rr = resultRuntime;

      // this function must NOT be called on the pyret stack
      return function(result) {
        var base_result = result;
        var doneDisplay = Q.defer();
        // Start a new pyret stack.
        // this returned function must not be called on the pyret stack
        // b/c `callingRuntime.runThunk` must not be called on the pyret stack
        callingRuntime.runThunk(function() {
          if(callingRuntime.isFailureResult(result)) {
            // Parse Errors
            return false;
          }
          else if(callingRuntime.isSuccessResult(result)) {
            result = result.result;
            return ffi.cases(ffi.isEither, "is-Either", result, {
              left: function(compileResultErrors) {
                return false;
              },
              right: function(v) {
                // TODO(joe): This is a place to consider which runtime level
                // to use if we have separate compile/run runtimes.  I think
                // that loadLib will be instantiated with callingRuntime, and
                // I think that's correct.
                return callingRuntime.pauseStack(function(restarter) {
                  rr.runThunk(function() {
                    var runResult = rr.getField(loadLib, "internal").getModuleResultResult(v);
                    if(rr.isSuccessResult(runResult)) {
                      return rr.safeCall(function() {
                        return checkUI.jsonCheckResults(output, CPO.documents, rr,
                                                        runtime.getField(runResult.result, "checks"), v);
                      }, function(result) {
                        if (result.some(c => c.error)) {
                          return false;
                        } else {
                          return result;
                        }
                      }, "rr.jsonCheckResults");
                    } else {
                      return false;
                    }
                  }, function(result) {
                    restarter.resume(result.result);
                  });
                });
              }
            });
          }
          else {
            return false;
          }
        }, function(r) {
          if (r.result === false) {
            doneDisplay.reject(base_result);
          } else {
            doneDisplay.resolve(r.result);
          }
          return base_result;
        });
      return doneDisplay.promise;
      }
    }

    //: -> (code -> printing it on the repl)
    function makeRepl(container, repl, runtime, options) {

      var Jsworld = worldLib;
      var items = [];
      var pointer = -1;
      var current = "";
      function loadItem() {
        CM.setValue(items[pointer]);
      }
      function saveItem() {
        items.unshift(CM.getValue());
      }
      function prevItem() {
        if (pointer === -1) {
          current = CM.getValue();
        }
        if (pointer < items.length - 1) {
          pointer++;
          loadItem();
          CM.refresh();
        }
      }
      function nextItem() {
        if (pointer >= 1) {
          pointer--;
          loadItem();
          CM.refresh();
        } else if (pointer === 0) {
          CM.setValue(current);
          CM.refresh();
          pointer--;
        }
      }

      container.append(mkWarningUpper());
      container.append(mkWarningLower());

      var promptContainer = jQuery("<div class='prompt-container'>");
      var prompt = jQuery("<span>").addClass("repl-prompt").attr("title", "Enter Pyret code here");
      function showPrompt() {
        promptContainer.hide();
        promptContainer.fadeIn(100);
        CM.setValue("");
        CM.focus();
        CM.refresh();
      }
      promptContainer.append(prompt);

      container.on("click", function(e) {
        if($(CM.getTextArea()).parent().offset().top < e.pageY) {
          CM.focus();
        }
      });

      function maybeShowOutputPending() {
        outputPendingHidden = false;
        setTimeout(function() {
          if(!outputPendingHidden) {
            output.append(outputPending);
          }
        }, 200);
      }
      runtime.setStdout(function(str) {
        });
      var currentZIndex = 15000;
      runtime.setParam("current-animation-port", function(dom, title, closeCallback) {
          var animationDiv = $("<div>").css({"z-index": currentZIndex + 1});
          animationDivs.push(animationDiv);
          output.append(animationDiv);
          function onClose() {
            Jsworld.shutdownSingle({ cleanShutdown: true });
            closeTopAnimationIfOpen();
          }
          closeCallback(closeTopAnimationIfOpen);
          animationDiv.dialog({
            title: title,
            position: ["left", "top"],
            bgiframe : true,
            modal : true,
            overlay : { opacity: 0.5, background: 'black'},
            //buttons : { "Save" : closeDialog },
            width : "auto",
            height : "auto",
            close : onClose,
            closeOnEscape : true
          });
          animationDiv.append(dom);
          var dialogMain = animationDiv.parent();
          dialogMain.css({"z-index": currentZIndex + 1});
          dialogMain.prev().css({"z-index": currentZIndex});
          currentZIndex += 2;
        });

      runtime.setParam("d3-port", function(dom, optionMutator, onExit, buttons) {
          // duplicate the code for now
          var animationDiv = $("<div>");
          animationDivs.push(animationDiv);
          output.append(animationDiv);
          function onClose() {
            onExit();
            closeTopAnimationIfOpen();
          }
          var baseOption = {
            position: [5, 5],
            bgiframe : true,
            modal : true,
            overlay : {opacity: 0.5, background: 'black'},
            width : 'auto',
            height : 'auto',
            close : onClose,
            closeOnEscape : true,
            create: function() {

              // from http://fiddle.jshell.net/JLSrR/116/

              var titlebar = animationDiv.prev();
              buttons.forEach(function(buttonData) {
                var button = $('<button/>'),
                    left = titlebar.find( "[role='button']:last" ).css('left');
                button.button({icons: {primary: buttonData.icon}, text: false})
                       .addClass('ui-dialog-titlebar-close')
                       .css('left', (parseInt(left) + 27) + 'px')
                       .click(buttonData.click)
                       .appendTo(titlebar);
              });
            }
          }
          animationDiv.dialog(optionMutator(baseOption)).dialog("widget").draggable({
            containment: "none",
            scroll: false,
          });
          animationDiv.append(dom);
          var dialogMain = animationDiv.parent();
          dialogMain.css({"z-index": currentZIndex + 1});
          dialogMain.prev().css({"z-index": currentZIndex});
          currentZIndex += 2;
          return animationDiv;
      });
      runtime.setParam("remove-d3-port", function() {
          closeTopAnimationIfOpen();
          // don't call .dialog('close'); because that would trigger onClose and thus onExit.
          // We don't want that to happen.
      });

      runtime.setParam('chart-port', function(args) {
        const animationDiv = $(args.root);
        animationDivs.push(animationDiv);
        output.append(animationDiv);

        let timeoutTrigger = null;

        const windowOptions = {
          title: '',
          position: [5, 5],
          bgiframe: true,
          width: 'auto',
          height: 'auto',
          beforeClose: () => {
            args.draw(options => $.extend({}, options, {chartArea: null}));
            args.onExit();
            closeTopAnimationIfOpen();
          },
          create: () => {
            // from http://fiddle.jshell.net/JLSrR/116/
            const titlebar = animationDiv.prev();
            titlebar.find('.ui-dialog-title').css({'white-space': 'pre'});
            let left = parseInt(titlebar.find("[role='button']:last").css('left'));
            function addButton(icon, fn) {
              left += 27;
              const btn = $('<button/>')
                .button({icons: {primary: icon}, text: false})
                .addClass('ui-dialog-titlebar-close')
                .css('left', left + 'px')
                .click(fn)
                .appendTo(titlebar);
              return btn;
            }

            addButton('ui-icon-disk', () => {
              let savedOptions = null;
              args.draw(options => {
                savedOptions = options;
                return $.extend({}, options, {chartArea: null});
              });
              const download = document.createElement('a');
              download.href = args.getImageURI();
              download.download = 'chart.png';
              // from https://stackoverflow.com/questions/3906142/how-to-save-a-png-from-javascript-variable
              function fireEvent(obj, evt){
                const fireOnThis = obj;
                if(document.createEvent) {
                  const evObj = document.createEvent('MouseEvents');
                  evObj.initEvent(evt, true, false);
                  fireOnThis.dispatchEvent(evObj);
                } else if(document.createEventObject) {
                  const evObj = document.createEventObject();
                  fireOnThis.fireEvent('on' + evt, evObj);
                }
              }
              fireEvent(download, 'click');
              args.draw(_ => savedOptions);
            });
          },
          resize: () => {
            if (timeoutTrigger) clearTimeout(timeoutTrigger);
            timeoutTrigger = setTimeout(args.draw, 100);
          },
        };

        if (args.isInteractive) {
          $.extend(windowOptions, {
            closeOnEscape: true,
            modal: true,
            overlay: {opacity: 0.5, background: 'black'},
            title: '   Interactive Chart',
          });
        } else {
          // need hide to be true so that the dialog will fade out when
          // closing (see https://api.jqueryui.com/dialog/#option-hide)
          // this gives time for the chart to actually render
          $.extend(windowOptions, {hide: true});
        }

        animationDiv
          .dialog($.extend({}, windowOptions, args.windowOptions))
          .dialog('widget')
          .draggable({
            containment: 'none',
            scroll: false,
          });

        // explicit call to draw to correct the dimension after the dialog has been opened
        args.draw();

        const dialogMain = animationDiv.parent();
        if (args.isInteractive) {
          dialogMain.css({'z-index': currentZIndex + 1});
          dialogMain.prev().css({'z-index': currentZIndex});
          currentZIndex += 2;
        } else {
          // a trick to hide the dialog while actually rendering it
          dialogMain.css({
            top: window.innerWidth * 2,
            left: window.innerHeight * 2,
          });
          animationDiv.dialog('close');
        }
      });

      runtime.setParam('remove-chart-port', function() {
          closeTopAnimationIfOpen();
          // don't call .dialog('close'); because that would trigger onClose and thus onExit.
          // We don't want that to happen.
      });

      var breakButton = options.breakButton;
      container[0].appendChild(status_widget.element);
      container.append(output);

      var img = $("<img>").attr({
        "src": "/img/pyret-spin.gif",
        "width": "25px",
      }).css({
        "vertical-align": "middle"
      });
      var runContents;
      function afterRun(cm) {
        return function() {
          running = false;
          outputPending.remove();
          outputPendingHidden = true;

          options.runButton.empty();
          options.runButton.append(runContents);
          options.runButton.attr("disabled", false);
          breakButton.attr("disabled", true);
          canShowRunningIndicator = false;
          if(cm) {
            cm.setValue("");
            cm.setOption("readonly", false);
          }
          //output.get(0).scrollTop = output.get(0).scrollHeight;
          showPrompt();
          setTimeout(function(){
            $("#output > .compile-error .cm-future-snippet").each(function(){this.cmrefresh();});
          }, 200);
        }
      }
      function setWhileRunning() {
        runContents = options.runButton.contents();
        canShowRunningIndicator = true;
        setTimeout(function() {
         if(canShowRunningIndicator) {
            options.runButton.attr("disabled", true);
            breakButton.attr("disabled", false);
            options.runButton.empty();
            var text = $("<span>").text("Running...");
            text.css({
              "vertical-align": "middle"
            });
            options.runButton.append([img, text]);
          }
        }, RUNNING_SPINWHEEL_DELAY_MS);
      }

      // SETUP FOR TRACING ALL OUTPUTS
      var replOutputCount = 0;
      outputUI.installRenderers(repl.runtime);

      repl.runtime.setParam("onSpy", function(loc, message, locs, names, vals) {
        return repl.runtime.safeCall(function() {
          /*
          var toBeRepred = [];
          for (var i = 0; i < names.length; i++)
            toBeRepred.push({name: names[i], val: vals[i]});
          toBeRepred.push({name: "Message", val: message, method: repl.runtime.ReprMethods._tostring});
          */
          // Push this afterward, to keep rendered aligned with renderedLocs below
          return repl.runtime.safeCall(function() {
            return repl.runtime.toReprJS(message, repl.runtime.ReprMethods._tostring);
          }, function(message) {
            return repl.runtime.safeCall(function() {
              return repl.runtime.raw_array_map(repl.runtime.makeFunction(function(val) {
                 return repl.runtime.toReprJS(val, repl.runtime.ReprMethods["$cpo"]);
              }, "spy-to-repr"), vals);
            }, function(rendered) {
              return {
                message: message,
                rendered: rendered
              }
            }, "CPO-onSpy-render-values");
          }, "CPO-onSpy-render-message");
        }, function(spyInfo) {
          var message = spyInfo.message;
          var rendered = spyInfo.rendered
          // Note: renderedLocs is one element shorter than rendered
          var renderedLocs = locs.map(repl.runtime.makeSrcloc);
          var spyBlock = $("<div>").addClass("spy-block");
          spyBlock.append($("<img>").addClass("spyglass").attr("src", "/img/spyglass.gif"));
          if (message !== "") {
            spyBlock.append($("<div>").addClass("spy-title").append(message));
          }

          var table = $("<table>");
          table
            .append($("<th>")
                    .append($("<tr>")
                            .append($("<td>").text("Name"))
                            .append($("<td>").text("Value"))));
          spyBlock.append(table);
          var palette = outputUI.makePalette();
          function color(i) {
            return outputUI.hueToRGB(palette(i));
          }
          for (let i = 0; i < names.length; i++) {
            let row = $("<tr>");
            table.append(row);
            let name = $("<a>").text(names[i]).addClass("highlight");
            name.attr("title", "Click to scroll source location into view");
            if (locs[i].length === 7) {
              var pos = outputUI.Position.fromSrcArray(locs[i], CPO.documents, {});
              name.hover((function(pos) {
                  return function() {
                    pos.hint();
                    pos.blink(color(i));
                  }
                })(pos),
                (function(pos) {
                  return function() {
                    outputUI.unhintLoc();
                    pos.blink(undefined);
                  };
                })(pos));
              name.on("click", (function(pos) {
                return function() { pos.goto(); };
              })(pos));
              // TODO: this is ugly code, copied from output-ui because
              // getting the right srcloc library is hard
              let cmLoc = {
                source: locs[i][0],
                start: {line: locs[i][1] - 1, ch: locs[i][3]},
                end: {line: locs[i][4] - 1, ch: locs[i][6]}
              };
              /*
              name.on("click", function() {
                outputUI.emphasizeLine(CPO.documents, cmLoc);
                CPO.documents[cmLoc.source].scrollIntoView(cmLoc.start, 100);
              });
              */
            }
            row.append($("<td>").append(name).append(":"));
            row.append($("<td>").append(rendered[i]));
          }
          $(output).append(spyBlock);
          return repl.runtime.nothing;
        }, "CPO-onSpy");
      });

      function renderWheatFailure(check_results) {
        let wheats = check_results.length;
        let failed =
          check_results.filter(
            wheat => wheat.some(
              block => block.error
                || block.tests.some(test => !test.passed))).length;

        let wheat_catchers =
          check_results.map(
            wheat => wheat.map(
              block => block.error
                || block.tests.filter(test => !test.passed)
                              .map(test => test.loc))
              .reduce((acc, val) => acc.concat(val), []));

        function render_wheat(catchers) {
          let wheat = document.createElement('a');
          wheat.setAttribute('href','#');
          wheat.classList.add('wheat');
          wheat.textContent = '⚙';

          if (catchers.length > 0) {
            wheat.classList.add('failed');
          }

          wheat.addEventListener('click',function(e) {
            e.preventDefault();
          });

          wheat.addEventListener('mouseenter',function() {
            catchers.forEach(function(loc) { loc.highlight('#FF0000'); });
          });

          wheat.addEventListener('mouseleave',function() {
            catchers.forEach(function(loc) { loc.highlight(''); });
          });

          return wheat;
        }

        status_widget.wheat_graph.value = {numerator: wheats - failed, denominator: wheats};

        let wheat_info = document.createElement('div');
        wheat_info.classList.add('wheat_info');

        let intro = document.createElement('p');
        intro.textContent = `Your tests rejected ${failed} out of ${wheats} wheats:`;
        wheat_info.appendChild(intro);

        let wheat_list = document.createElement('ul');
        wheat_list.classList.add('wheat_list');

        wheat_catchers.map(render_wheat)
          .forEach(function(wheat_widget){
            let li = document.createElement('li');
            li.appendChild(wheat_widget);
            wheat_list.appendChild(li);
          });

        wheat_info.appendChild(wheat_list);

        let outro = document.createElement('p');
        outro.textContent = "The wheats your tests rejected are highlighted above in red. Mouseover a wheat to see which of your tests rejected it. Are these tests consistent with the problem specification?";

        if (failed != wheats) {
          outro.textContent += " Do they test unspecified behavior?";
        }

        wheat_info.appendChild(outro);
        output.append(wheat_info);
      }

      function renderChaffResults(check_results) {
        let chaffs = check_results.length;
        let caught =
          check_results.filter(
            chaff => !chaff.every(
              block => !block.error
                && block.tests.every(test => test.passed))).length;

        let chaff_catchers =
          check_results.map(chaff =>
              chaff.map(block => block.tests.filter(test => !test.passed)
                                            .map(test => test.loc))
                .reduce((acc, val) => acc.concat(val), []));

        function render_chaff(catchers) {
          let chaff = document.createElement('a');
          chaff.setAttribute('href','#');
          chaff.classList.add('chaff');
          chaff.textContent = '🐛';

          if (catchers.length > 0) {
            chaff.classList.add('caught');
          }

          chaff.addEventListener('click',function(e) {
            e.preventDefault();
          });

          chaff.addEventListener('mouseenter',function() {
            catchers.forEach(function(loc) { loc.highlight('#91ccec'); });
          });

          chaff.addEventListener('mouseleave',function() {
            catchers.forEach(function(loc) { loc.highlight(''); });
          });

          return chaff;
        }

        status_widget.chaff_graph.value = {numerator: caught, denominator: chaffs};

        let chaff_info = document.createElement('div');
        chaff_info.classList.add('chaff_info');

        let intro = document.createElement('p');
        intro.textContent = `You caught ${caught} out of ${chaffs} chaffs:`;
        chaff_info.appendChild(intro);

        let chaff_list = document.createElement('ul');
        chaff_list.classList.add('chaff_list');

        chaff_catchers.map(render_chaff)
          .forEach(function(chaff_widget){
            let li = document.createElement('li');
            li.appendChild(chaff_widget);
            chaff_list.appendChild(li);
          });

        chaff_info.appendChild(chaff_list);

        let outro = document.createElement('p');
        outro.textContent = "The chaffs you caught are highlighted above in blue. Mouseover a chaff to see which of your tests caught it.";
        chaff_info.appendChild(outro);

        output.append(chaff_info);

        if (caught == chaffs) {
          let reminder = document.createElement('p');
          reminder.textContent = "Nice work! Remember, the set of chaffs in Examplar is only a subset of what we'll run your final test submission against, so keep writing tests! You can continue to use Examplar to ensure that your tests accept the wheats.";
          chaff_info.appendChild(reminder);
        }
      }

      var runMainCode = function(src, uiOptions) {
        if(running) { return; }
        running = true;
        output.empty();
        promptContainer.hide();
        lastEditorRun = uiOptions.cm || null;
        setWhileRunning();

        CPO.documents.forEach(function(doc, name) {
          if (name.indexOf("interactions://") === 0)
            CPO.documents.delete(name);
        });

        CPO.documents.set("definitions://", uiOptions.cm.getDoc());

        interactionsCount = 0;
        replOutputCount = 0;
        logger.log('run', { name      : "definitions://",
                            type_check: !!uiOptions["type-check"]
                          });
        var options = {
          typeCheck: !!uiOptions["type-check"],
          checkAll: false // NOTE(joe): this is a good spot to fetch something from the ui options
                          // if this becomes a check box somewhere in CPO
        };

        Q.all([window.user, window.assignment_id, window.program_id])
          .done(function([email, id, gdrive_id]) {
            return fetch("https://us-central1-pyret-examples.cloudfunctions.net/submit", {
              method: 'PUT',
              body: JSON.stringify({email: email, assignment: id, gdrive: gdrive_id, submission: CPO.documents.get("definitions://").getValue()}),
              headers:{
                'Content-Type': 'application/json'
              }
            })
          }, function (err) {
            console.error("Failed to submit sweep.", err);
            window.stickError("Failed to submit sweep.");
          });

        function run_injections(injections) {
          let first = injections[0];
          let rest = injections.slice(1);
          if (first !== undefined) {
            window.injection = first;
            return repl.restartInteractions(src, options)
              .then(jsonResult(output, runtime, repl.runtime, true))
              .then(
                function(result) {
                  return run_injections(rest)
                    .then(function(rest_results) {
                      rest_results.push(result);
                      return rest_results;
                    });
                });
          } else {
            return Q([]);
          }
        }

        status_widget.wheat_graph.value = {numerator: "none", denominator: "none"};
        status_widget.chaff_graph.value = {numerator: "none", denominator: "none"};

        window.wheat.then(run_injections)
          .then(function(r) { maybeShowOutputPending(); return r; })
          .then(
            function (check_results) {
              let wheats = check_results.length;
              let passed =
                check_results.filter(
                  wheat => wheat.every(
                    block => !block.error
                      && block.tests.every(test => test.passed))).length;

              let all_passed = wheats == passed;

              status_widget.wheat_graph.value = {numerator: passed, denominator: wheats};

              if (all_passed) {
                return window.chaff.then(run_injections).then(renderChaffResults,
                        displayResult(output, runtime, repl.runtime, true));
              } else {
                afterRun(false);
                renderWheatFailure(check_results);
              }
            }, function(run_result) {
              return displayResult(output, runtime, repl.runtime, true)(run_result);
            })
          .fin(afterRun(false));
      };

      var runner = function(code) {
        if(running) { return; }
        running = true;
        items.unshift(code);
        pointer = -1;
        var echoContainer = $("<div class='echo-container'>");
        var echoSpan = $("<span>").addClass("repl-echo");
        var echo = $("<textarea>");
        echoSpan.append(echo);
        echoContainer.append(echoSpan);
        write(echoContainer);
        var echoCM = CodeMirror.fromTextArea(echo[0], { readOnly: true });
        echoCM.setValue(code);
        CM.setValue("");
        promptContainer.hide();
        setWhileRunning();
        interactionsCount++;
        var thisName = 'interactions://' + interactionsCount;
        CPO.documents.set(thisName, echoCM.getDoc());
        logger.log('run', { name: thisName });
        var replResult = repl.run(code, thisName);
//        replResult.then(afterRun(CM));
        var startRendering = replResult.then(function(r) {
          maybeShowOutputPending();
          return r;
        });
        var doneRendering = startRendering.then(displayResult(output, runtime, repl.runtime, false)).fail(function(err) {
          console.error("Error displaying result: ", err);
        });
        doneRendering.fin(afterRun(CM));
      };

      var CM = CPO.makeEditor(prompt, {
        simpleEditor: true,
        run: runner,
        initial: "",
        cmOptions: {
          extraKeys: CodeMirror.normalizeKeyMap({
            'Enter': function(cm) { runner(cm.getValue(), {cm: cm}); },
            'Shift-Enter': "newlineAndIndent",
            'Up': prevItem,
            'Down': nextItem,
            'Ctrl-Up': "goLineUp",
            'Ctrl-Alt-Up': "goLineUp",
            'Ctrl-Down': "goLineDown",
            'Ctrl-Alt-Down': "goLineDown",
            'Esc Left': "goBackwardSexp",
            'Alt-Left': "goBackwardSexp",
            'Esc Right': "goForwardSexp",
            'Alt-Right': "goForwardSexp",
            'Ctrl-Left': "goBackwardToken",
            'Ctrl-Right': "goForwardToken"
          })
        }
      }).cm;

      CM.on('beforeChange', function(instance, changeObj){textHandlers.autoCorrect(instance, changeObj, CM);});

      CPO.documents.set('definitions://', CM.getDoc());

      var lastNameRun = 'interactions';
      var lastEditorRun = null;

      var write = function(dom) {
        output.append(dom);
      };

      var onBreak = function() {
        breakButton.attr("disabled", true);
        repl.stop();
        closeAnimationIfOpen();
        Jsworld.shutdown({ cleanShutdown: true });
        showPrompt();
      };

      breakButton.attr("disabled", true);
      breakButton.click(onBreak);

      return {
        runCode: runMainCode,
        focus: function() { CM.focus(); }
      };
    }

    return runtime.makeJSModuleReturn({
      makeRepl: makeRepl,
      makeEditor: CPO.makeEditor
    });

  }
})
