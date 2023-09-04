({
  requires: [
    { "import-type": "dependency",
      protocol: "js-file",
      args: ["./output-ui"] },
    { "import-type": "dependency",
      protocol: "js-file",
      args: ["./error-ui"] },
    { "import-type": "builtin",
      name: "option" },
    { "import-type": "builtin",
      name: "srcloc" },
    { "import-type": "builtin",
      name: "checker" },
    { "import-type": "builtin",
      name: "load-lib" }
  ],
  provides: {},
  nativeRequires: [],
  theModule: function(runtime, _, uri, outputUI, errorUI, option, srcloc, checker, loadLib) {

    option = runtime.getField(option, "values");
    srcloc = runtime.getField(srcloc, "values");
    var CH = runtime.getField(checker, "values");

    function isTestResult(val) { return runtime.unwrap(runtime.getField(CH, "TestResult").app(val)); }
    function isTestSuccess(val) { return runtime.unwrap(runtime.getField(CH, "is-success").app(val)); }

    function getStrFromLocObj(l) {
      const name = JSON.parse(l.str);
      const startLine = name[1].line;
      const startChar = name[1].ch;
      const endLine = name[2].line;
      const endChar = name[2].ch;

      const fileLines = l.doc.children[0].lines;
      
      if (startLine == endLine) {
        return fileLines[startLine].text.substring(startChar, endChar);
      }

      const firstStr = fileLines[startLine].text.substring(startChar);
      const betweenLinesStr = fileLines.slice(startLine + 1, endLine).map(l => l.text).join("\n");
      const lastStr = fileLines[endLine].text.substring(0, endChar);

      return `${firstStr}${betweenLinesStr}${lastStr}`;
    }
    const QTM_IN_SUFFIX = "-in-ok";
    const QTM_OUT_SUFFIX = "-out-ok";
    function testedFuncHasSuffix(testAstStr, suffix) {
      // TODO @eerivera: This really needs to be parsed properly. I'm surprised the AST info isn't already available somewhere.
      const attempt1 = testAstStr.split(" satisfies ");
      if (attempt1.length == 2) {
        return attempt1[1].endsWith(suffix);
      }

      const attempt2 = testAstStr.split(" violates ");
      if (attempt2.length == 2) {
        return attempt2[1].endsWith(suffix);
      }

      const attempt3 = testAstStr.split(" is ");
      if (attempt3.length == 2) {
        const funcall = attempt3[1].split("(")[0];
        return funcall.endsWith(suffix);
      }

      // If it's not one of the three kinds of tests above, we just assume it's not an in/out-ok test
      return false;
    }
    function isQtmInputTest(test) {
      let testAsStr = getStrFromLocObj(test.loc);
      return testedFuncHasSuffix(testAsStr, QTM_IN_SUFFIX);
    }
    function isQtmOutputTest(test) {
      let testAsStr = getStrFromLocObj(test.loc);
      return testedFuncHasSuffix(testAsStr, QTM_OUT_SUFFIX);
    }
    function isQtmTest(test) {
      let testAsStr = getStrFromLocObj(test.loc);
      return testedFuncHasSuffix(testAsStr, QTM_IN_SUFFIX) || testedFuncHasSuffix(testAsStr, QTM_OUT_SUFFIX);
    }
    function isQtmChaff(cb_array) {
      let name = cb_array[0].filename;
      return name.includes(QTM_IN_SUFFIX) || name.includes(QTM_OUT_SUFFIX);
    }



    // https://stackoverflow.com/a/38327540/7501301
    function groupBy(list, keyGetter) {
        const map = new Map();
        list.forEach((item) => {
             const key = keyGetter(item);
             const collection = map.get(key);
             if (!collection) {
                 map.set(key, [item]);
             } else {
                 collection.push(item);
             }
        });
        return map;
    }

    // NOTE: MUST BE CALLED WHILE RUNNING ON runtime's STACK
    function jsonCheckResults(container, documents, runtime, checkResults, result) {
      var ffi = runtime.ffi;
      var cases = ffi.cases;
      var get = runtime.getField;

      // RETURNED FUNCTION MUST BE CALLED IN THE CONTEXT OF THE PYRET STACK
      function applyMethod(value, name, args) {
        return runtime.
          safeThen(function() {
            return runtime.getField(value, name);
          }, applyMethod).then(function(fun) {
            return fun.app.apply(value, args);
          })
      }

      // MUST NOT BE CALLED ON PYRET STACK
      function format(loc) {
        return Q(outputUI.Position.fromPyretSrcloc(runtime, srcloc, loc, documents));
      }

      var any = runtime.makeFunction(function(_){return runtime.pyretTrue;});
      var contents = ffi.toArray(checkResults);
      var result   = [];

      function render_TestResult(testresult) {
        function render_result(passed) {
          return function(loc) {
            return format(loc)
              .then(function(loc){return {loc: loc, passed: passed};});
          };
        }
        return runtime.ffi.cases(any, "TestResult", testresult, {
           "success"  : function(_) {return render_result(true)(testresult.dict.loc);},
           "else"     : function(r) {return render_result(false)(r.dict.loc);},
        });
      }

      function render_CheckBlockResult(checkblockresult) {
        return runtime.ffi.cases(any, "CheckBlockResult", checkblockresult, {
          "check-block-result": function(name,loc,keyword_check,test_results,maybe_err) {
            var results = runtime.ffi.toArray(test_results);
            var render  = [];
            return runtime.safeThen(function() {
                return runtime.eachLoop(runtime.makeFunction(function(i) {
                    return render_TestResult(results[i])
                      .then(function(rendered) {render.push(rendered);});
                  }), 0, results.length);
              }, render_CheckBlockResult)
              .then(function(_) {
                return { name : name,
                         loc  : outputUI.Position.fromPyretSrcloc(runtime, srcloc, loc, documents),
                         error: runtime.ffi.isSome(maybe_err),
                         tests: render }; })
          }});
      }

      return runtime.safeCall(function() {
        return runtime.eachLoop(runtime.makeFunction(function(i) {
          return render_CheckBlockResult(contents[i])
            .then(function(rendered) { result.push(rendered); })
            .start();
        }), 0, contents.length);
      }, function(_) {
        return result;
      }, "check-block-comments: each: contents");
    }

    function getHint() {      
      const DEFAULT_TEXT ="Examplar was unable to find a hint. This is sometimes indicative of a typo in your invalid test — please double check!";
      const HINT_PREFIX = "<h3>Hint</h3>";

      function get_hint_text() {
        let wfes = window.hint_candidates
        let num_wfes =   (wfes != null) ? Object.keys(wfes).length : 0;
        if (num_wfes  == 0) {
          return DEFAULT_TEXT;
        }
        else if (num_wfes > 1) {
          // This is (hopefully) unreachable.
          // However, keeping it in as a backstop in case
          // Examplar reaches a state where there are multiple wheat failures
          // and we're still looking for a hint.
          return  `There are currently too many invalid tests to provide further feedback.
          The system may be able to provide more directed feedback
          when there is exactly one invalid test.`;
        }

        let test_id = Object.keys(wfes)[0];
        let candidate_chaffs = wfes[test_id];
  
        // We can only provide useful hints when wfe's accept exactly 1 or 2 chaffs.
        if (candidate_chaffs.length > 2)
        {
            return DEFAULT_TEXT;
        }

        let text = "";
        for (var i in candidate_chaffs) {
          let c = candidate_chaffs[i];
          let chaff_metadata = (c in window.hints) ? window.hints[c] : "";
          let hint_text =
            (typeof chaff_metadata === 'string' || chaff_metadata instanceof String)
            ? chaff_metadata // Backcompat: In 2022, there was no chaff metadata.
            : chaff_metadata['hint'];


            let hint_html = `<div style="border: 1px solid #ccc; padding: 10px;">
              ${hint_text}
              <div class="text-right text-muted">
              <button class="hint_upvote" id="hint_upvote_${c}" onclick="window.vote(this)" >👍</button>
              <button class="hint_downvote" id="hint_downvote_${c}" onclick="window.vote(this)">👎</button>
              </div>
            </div>`;

            text += hint_html + "<br>";
        }
        return (text.length == 0) ? DEFAULT_TEXT : text;
      }

      
      let container = document.createElement("div");
      container.classList += ["container-fluid"];
      try {
        hint_text = get_hint_text();
        container.innerHTML = `<div>${HINT_PREFIX + hint_text}</div>`;

        window.vote =  function (button) {
          const bId = button.getAttribute('id');
          let content = document.getElementById("output");

          let payload = {
            "hint_id": bId,
            "context": content
          };

          const event_type = button.getAttribute('class');

          console.log(payload);
          window.cloud_log(event_type, payload);
        }
      }
      catch(e) {
        console.error('Error generating hint:', e)
        container.innerHTML = "Something went wrong, failed to find a hint.";
      }
      finally {
        container.id = "hint_box";
        return container;
      }
    }

    function hasValidity(examplar_results) {
      return !(examplar_results == null ||
             ( examplar_results != null &&
               examplar_results.wheat != null &&
               examplar_results.wheat.length == 0));
    }

    function drawExamplarResults(check_blocks, examplar_results, is_qtm_block=false) {
      const class_prefix = is_qtm_block ? "qtm-" : "";

      let container_elt = document.createElement("div");
      container_elt.classList.add("file-examplar-summary");

      let validity_elt = document.createElement("div");
      validity_elt.classList.add("file-examplar-summary-validity");

      let thoroughness_elt = document.createElement("div");
      thoroughness_elt.classList.add("file-examplar-summary-thoroughness");

      let message_elt = document.createElement("div");
      message_elt.classList.add("file-examplar-summary-message");

      container_elt.appendChild(validity_elt);
      container_elt.appendChild(thoroughness_elt);
      container_elt.appendChild(message_elt);

      if (!hasValidity(examplar_results)) {
        thoroughness_elt.textContent = "CONSEQUENTLY, THOROUGHNESS IS UNKNOWN";
        validity_elt.textContent = "VALIDITY UNKNOWN";
        validity_elt.classList.add("maybe-valid");
        message_elt.textContent = "Tests in this file are not checked against other implementations. Consequently, we cannot provide you with validity and thoroughness feedback for these tests.";
        return container_elt;
      } else if (examplar_results.error) {
        thoroughness_elt.textContent = "ERROR ENCOUNTERED";
        validity_elt.textContent = "INVALID";
        validity_elt.classList.add(`${class_prefix}invalid`);
        container_elt.classList.add(`${class_prefix}invalid`);
        message_elt.textContent = "A check block encountered an error.";

        return container_elt;
      }

      let wheats = examplar_results.wheat;
      let chaffs = examplar_results.chaff;

      let num_wheats = wheats.length;
      let num_passed =
        wheats.filter(
          wheat => wheat.every(
            block => !block.error
              && block.tests.every(test => test.passed))).length;

      let all_passed = num_wheats == num_passed;

      if (all_passed) {
        const implementation_to_check = (wheats.length > 0) ? wheats[0] : ((chaffs.length > 0) ? chaffs[0] : undefined);
        const has_qtm_in_test = (implementation_to_check !== undefined) ? implementation_to_check.some(block => block.tests.some(isQtmInputTest)) : false;
        const has_qtm_out_test = (implementation_to_check !== undefined) ? implementation_to_check.some(block => block.tests.some(isQtmOutputTest)) : false;

        if (is_qtm_block && !(has_qtm_in_test || has_qtm_out_test)) {
          validity_elt.textContent = "VALIDITY UNKNOWN";
          validity_elt.classList.add("maybe-valid");
          message_elt.innerHTML = `Quartermaster was not run. Refer to the documentation on how to use the <code>*-in-ok</code> and <code>*-out-ok</code> functions to check your inputs and outputs.`;
          return container_elt;
        }

        validity_elt.textContent = "VALID";
        validity_elt.classList.add(`${class_prefix}valid`);

        let num_chaffs = chaffs.length;

        let num_caught =
          chaffs.filter(
            chaff => !chaff.every(
              block => !block.error
                && block.tests.every(test => test.passed))).length;

        let chaff_catchers =
          chaffs.map(chaff =>
              chaff.map(function(block) {
                if (block.error) {
                  return [block.loc];
                } else {
                  return block.tests.filter(test => !test.passed)
                                    .map(test => test.loc)
                }
              })
                .reduce((acc, val) => acc.concat(val), []));

        let chaff_list = document.createElement('ul');
        chaff_list.classList.add(`${class_prefix}chaff_list`);

        function render_chaff(catchers) {
          let chaff = document.createElement('a');
          chaff.setAttribute('href','#');
          chaff.classList.add('chaff');
          chaff.textContent = is_qtm_block ? '🌠' : '🐛';

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
            catchers.forEach(function(loc) { loc.highlight(); });
          });

          return chaff;
        }


        chaff_catchers.map(render_chaff)
          .forEach(function(chaff_widget){
            let li = document.createElement('li');
            li.appendChild(chaff_widget);
            chaff_list.appendChild(li);
          });

        const qtm_submessage = has_qtm_in_test
          ? (has_qtm_out_test
            ? "inputs and ouputs checked with the <code>*-in-ok</code> and <code>*-out-ok</code> functions"
            : "inputs checked with the <code>*-in-ok</code> functions")
          : (has_qtm_out_test
            ? "outputs checked with the <code>*-out-ok</code> functions"
            : undefined); // unreachable
        const input_space_submessage = has_qtm_in_test ? `They also explored ${num_caught} of our ${num_chaffs} envisioned partitions of the input space. Add more inputs that cover more of the input space.` : "";
        const qtm_message = `The ${qtm_submessage} are <span class="valid">valid and consistent</span> with the assignment handout. ${input_space_submessage}`;
        
        message_elt.innerHTML = is_qtm_block
          ? qtm_message 
          : `These tests are <span class="valid">valid and consistent</span> with the assignment handout. They caught ${num_caught} of ${num_chaffs} sample buggy programs. Add more test cases to improve this test suite's thoroughness.`;
        thoroughness_elt.appendChild(chaff_list);

      } else {
        const things_mismatched = is_qtm_block ? "inputs and/or outputs" : "tests";

        thoroughness_elt.textContent = "CONSEQUENTLY, THOROUGHNESS IS UNKNOWN";
        validity_elt.textContent = "INCORRECT";
        validity_elt.classList.add(`${class_prefix}invalid`);
        container_elt.classList.add(`${class_prefix}invalid`);
        message_elt.textContent = `These ${things_mismatched} do not match intended behavior:`;

        // Only display hints outside of Quartermaster
        if (!is_qtm_block) {
          // Only count wfes that are failing across all wheats.
          // TODO: Handle wfes that are in the inter-wheat space.
          // Perhaps we should flag them differently in examplar.
          let num_wfe =
          wheats.map(
            wheat => wheat.reduce(
              (acc, block) => acc + block.tests.reduce(
                (wfes_in_block, test) => wfes_in_block + (test.passed ? 0 : 1),
                0), 0))             
              .reduce((a, b) => Math.max(a, b), -Infinity);

          if (window.hint_run) {        
            try {
              let hint = getHint();       
              message_elt.parentElement.appendChild(hint);
            }
            catch (e) {
              console.error(`Error generating hint: ${e}`)
            }
            finally {
              window.hint_run = false;
              window.hint_candidates = null;
            }
          }
          else { 
            window.gen_hints =  function () {
              window.hint_run = true; 
              window.cloud_log("GEN_HINT", "");
              document.getElementById('runButton').click()
            }

            let c = document.createElement("div");
            c.classList += ["container-fluid"];
            c.id = "hint_box";

              c.innerHTML = (num_wfe == 1) ?
                ` <div class="card-body> 
                      <p class="card-text">
                        The system <em>may</em> be able to provide a hint about why this test is invalid.<br><br>
                        <button id='hint_button' class="btn btn-success" onclick="window.gen_hints()"> Try to find a hint! </button>
                        </p> </div>`
              : `<div class="card-body> <p class="card-text">
                There are currently too many invalid tests to provide further feedback.
                The system may be able to provide more directed feedback
                when there is exactly one invalid test. </p>    
                </p> </div>`;

            message_elt.parentElement.appendChild(c);
          }
        }

        let wheat_catchers =
          wheats.map(
            wheat => wheat.map(
              block => block.error
                ? block.loc
                : block.tests.filter(test => !test.passed)
                             .map(test => test.loc))
              .reduce((acc, val) => acc.concat(val), []))
            .reduce((acc, val) => acc.concat(val), []);

        function render_wheat_catcher(position) {
          console.log("rendering", position);
          let snippet = new outputUI.Snippet(position);
          message_elt.appendChild(snippet.container);
        }

        let dedup = new Object({});
        wheat_catchers.forEach(p => dedup[p.str] = p);
        for (var pos of Object.values(dedup)) {
          render_wheat_catcher(pos);
        }
      }

      return container_elt;
    }

    // NOTE: MUST BE CALLED WHILE RUNNING ON runtime's STACK
    function drawCheckResults(container, documents, runtime, checkResults, result, examplarResults) {
      console.info("examplarResults", examplarResults);
      var ffi = runtime.ffi;
      var cases = ffi.cases;
      var get = runtime.getField;

      let checkErroredSkeletons = new Array();
      let testsFailedSkeletons  = new Array();
      let testsPassedSkeletons  = new Array();

      var noFramesMaybeStackLoc =
        runtime.makeFunction(function(n, userFramesOnly) {
          return runtime.ffi.makeNone();
        });

      function makeNameHandle(text, loc, color) {
        var anchor = document.createElement("a");
        anchor.classList.add("hinted-highlight");
        anchor.textContent = text;
        var source = get(loc, "source");
        var handle = undefined;
        if (CPO.sourceAPI.is_loaded(source)) {
          handle = outputUI.Position.fromPyretSrcloc(runtime, srcloc, loc, documents);
          anchor.addEventListener("click", function(e) {
            handle.goto();
            e.stopPropagation();
          });
          anchor.addEventListener("mouseover", function(e) {
            handle.hint();
          });
          anchor.addEventListener("mouseleave", function(e) {
            outputUI.unhintLoc();
          });
        } else {
          anchor.addEventListener("click", function(e){
            window.flashMessage("This code is not in this editor.");
          });
        }
        return {anchor: anchor, handle: handle};
      }

      function makeGutterMarker(spanHandle, clickFunc) {
        let doc = spanHandle.doc;
        let editor = doc.getEditor() || CPO.editor.cm;

        var lineHandle =
          doc.addLineClass(
            spanHandle.from.line,
            "gutter",
            "failed-test-marker");

        function onClick(cm, line, gutter) {
          if (cm.getDoc() != doc)
            return;
          if (cm.getLineNumber(lineHandle) !== line)
            return;
          clickFunc();
        }

        editor.on("gutterClick", onClick);

        function onChange(line) {
          var spanLineNo = spanHandle.from;
          if(spanLineNo === undefined)
            return;
          var lineNo = line.lineNo();
          if(lineNo === undefined)
            return;
          else if (spanLineNo.line != lineNo) {
            line.off("change", onChange);
            line.off("delete", onDelete);
            doc.removeLineClass(lineNo, "gutter", "failed-test-marker");
            lineHandle = doc.addLineClass(spanLineNo.line, "gutter", "failed-test-marker");
            lineHandle.on("change", onChange);
            lineHandle.on("delete", onDelete);
          }
        }

        function onDelete(line) {
          var spanLineNo = spanHandle.from;
          if (spanLineNo === undefined)
            lineHandle = undefined;
          if (lineHandle !== undefined) {
            lineHandle = doc.addLineClass(spanLineNo.line, "gutter", "failed-test-marker");
            lineHandle.on("change", onChange);
            lineHandle.on("delete", onDelete);
          }
        }

        lineHandle.on("change", onChange);
        lineHandle.on("delete", onDelete);

        spanHandle.on("clear", function (from, _) {
          editor.off("gutterClick", onClick);
          doc.removeLineClass(from.line, "gutter", "failed-test-marker");
        });

        spanHandle.on("hide",
          function(){
            if(lineHandle === undefined)
              return;
            editor.off("gutterClick", onClick);
            lineHandle.off("change", onChange);
            lineHandle.off("delete", onDelete);
            doc.removeLineClass(lineHandle.lineNo(), "gutter", "failed-test-marker");
            lineHandle = undefined;
          });

        spanHandle.on("unhide",
          function(){
            lineHandle = doc.addLineClass(spanHandle.from.line, "gutter", "failed-test-marker");
            editor.on("gutterClick", onClick);
            lineHandle.on("change", onChange);
            lineHandle.on("delete", onDelete);
          });

      }

      function makeTestHeader(testNumber, loc, isPassing) {
        var header = document.createElement("header");
        var nameHandle   = makeNameHandle("Test " + testNumber, loc,
          (isPassing ? "hsl(88, 50%, 76%)" : "hsl(45, 100%, 85%)"));
        var name   = nameHandle.anchor;
        var handle = nameHandle.handle;
        var status = document.createTextNode(isPassing ? ": Passed" : ": Failed");
        header.appendChild(name);
        header.appendChild(status);
        return {header : header, handle : handle};
      }

      var lastHighlighted = undefined;

      var FailingTestSkeleton = function () {
        function FailingTestSkeleton(block, test, testNumber) {
          var container = document.createElement("div");
          var headerHandle = makeTestHeader(testNumber, get(test, "loc"), false);
          var header = headerHandle.header;
          var handle = headerHandle.handle;
          var tombstone = document.createElement("div");
          container.classList.add("check-block-test");
          container.classList.add("failing-test");
          tombstone.classList.add("test-reason");
          container.appendChild(header);
          container.appendChild(tombstone);
          var thisTest = this;
          var source = get(get(test, "loc"), "source");
          if (CPO.sourceAPI.is_loaded(source)) {
            let doc = CPO.sourceAPI.get_loaded(source).document;
            makeGutterMarker(handle, function () {
              thisTest.block.showTest(thisTest);
            });
          }

          if(runtime.hasField(test, "actual-exn")) {
            var stack = get(loadLib, "internal")
              .enrichStack(get(test, "actual-exn").val, get(loadLib, "internal").getModuleResultRealm(result));
            this.maybeStackLoc = outputUI.makeMaybeStackLoc(
              runtime, documents, srcloc, stack);
          } else {
            this.maybeStackLoc = noFramesMaybeStackLoc;
          }
          this.block = block;
          this.renderable = test;
          this.container = container;
          this.tombstone = tombstone;
        }

        FailingTestSkeleton.prototype.highlight = function highlight() {
          outputUI.clearEffects();
          if (this.rendering) {
            this.rendering.addClass("highlights-active");
            this.rendering.trigger("toggleHighlight");
          }
          lastHighlighted = this;
          lastHighlighted.container.classList.add("highlights-active");
          lastHighlighted.tombstone.classList.add("highlights-active");
        };

        FailingTestSkeleton.prototype.refresh = function refresh() {
          var snippets = this.tombstone.querySelectorAll(".CodeMirror");
          for (var i = 0; i < snippets.length; i++) {
            window.requestAnimationFrame(
              CodeMirror.prototype.refresh.bind(snippets[i].CodeMirror));
          }
        };

        /* Replace the placeholder for the failing test with the error rendering */


        FailingTestSkeleton.prototype.vivify = function vivify(rendering) {
          this.tombstone.appendChild(rendering[0]);
          this.rendering = rendering;
          var thisTest = this;
          this.container.addEventListener("click", function (e) {
            thisTest.highlight();
            e.stopPropagation();
          });
          if (this.block.container.classList.contains("expanded")) {
            this.refresh();
          } else {
            this.block.needRefreshing.push(this);
          }
        };

        return FailingTestSkeleton;
      }();

      var PassingTestSkeleton = function () {
        function PassingTestSkeleton(block, test, testNumber) {
          var loc = get(test, "loc");
          var container = document.createElement("div");
          var headerHandle = makeTestHeader(testNumber, loc, true);
          var header = headerHandle.header;
          var handle = headerHandle.handle;
          var tombstone = document.createElement("div");
          container.classList.add("check-block-test");
          container.classList.add("passing-test");
          tombstone.classList.add("test-reason");
          container.appendChild(header);
          container.appendChild(tombstone);
          this.block = block;
          this.handle = handle;
          this.container = container;
          this.tombstone = tombstone;
        }

        PassingTestSkeleton.prototype.highlight = function highlight() {
          return;
        };

        /* Replace the placeholder for the failing test with the error rendering */
        PassingTestSkeleton.prototype.vivify = function vivify() {
          var snippet  = new outputUI.Snippet(this.handle);
          this.tombstone.appendChild(snippet.container);
          if (this.block.container.classList.contains("expanded")) {
            snippet.editor.refresh();
          } else {
            this.block.needRefreshing.push(snippet.editor);
          }
        };

        return PassingTestSkeleton;
      }();

      // the currently expanded check block
      var expandedCheckBlock = undefined;

      var FileSkeleton = function () {
        function FileSkeleton(name, blocks, examplar_results) {
          let _this = this;
          let skeletons = blocks.map(block => new CheckBlockSkeleton(_this, block));

          let container = document.createElement("div");
          container.classList.add("file-test-results");

          let header = document.createElement("header");
          this.name = CPO.sourceAPI.get_loaded(name).file.getName();
          header.textContent = this.name;
          container.appendChild(header);

          function implementationFilter(blocks, lookingForQtm) {
            return blocks.map(block => {
              return {
                ...block,
                tests: block.tests.filter(x => isQtmTest(x) == lookingForQtm).map(x => {
                  return {
                    ...x,
                    name: getStrFromLocObj(x.loc)
                  };
                })
              };
            });
          }
          const qtm_results = examplar_results != null ? {
            wheat: examplar_results.wheat.map(x => implementationFilter(x, true)),
            chaff: examplar_results.chaff.filter(isQtmChaff).map(x => implementationFilter(x, true))
          } : null;
          const regular_results = examplar_results != null ? {
            wheat: examplar_results.wheat.map(x => implementationFilter(x, false)),
            chaff: examplar_results.chaff.filter(cb_array => !isQtmChaff(cb_array)).map(x => implementationFilter(x, false))
          } : null;

          let examplar_summary = window.wheat.then(wheat => {
            if (wheat.length == 0) return document.createElement("div");

            let examplar_header = document.createElement("h3");
            examplar_header.textContent = "Examplar";
            let examplar_summary = drawExamplarResults(blocks, regular_results, is_qtm_block=false);
            header.parentNode.insertBefore(examplar_summary, header.nextSibling);
            header.parentNode.insertBefore(examplar_header, examplar_summary);

            if (qtm_results != null && qtm_results.chaff.length > 0) {
              let qtm_header = document.createElement("h3");
              qtm_header.textContent = "Quartermaster";
              let qtm_summary = drawExamplarResults(blocks, qtm_results, is_qtm_block=true);
              qtm_summary.style.marginBottom = "3em";
              header.parentNode.insertBefore(qtm_summary, header.nextSibling);
              header.parentNode.insertBefore(qtm_header, qtm_summary);
            }
            
            return examplar_summary;
          });

          let summary = document.createElement("span");
          summary.classList.add("file-test-results-summary");

          // the number of tests that ran
          let checkTotalAll = skeletons.map(s => s.testsExecuted).reduce((a, b) => a + b, 0);
          // the number of tests that passed
          let checkPassedAll = skeletons.map(s => s.testsPassed).reduce((a, b) => a + b, 0);
          // the number of tests that failed
          let testsFailedAll = (checkTotalAll - checkPassedAll);

          let checkBlocksErrored = skeletons.filter(s => s.encounteredError).length;

          function TESTS(n){return n == 1 ? "TEST" : "TESTS";}

          let summary_bits = $("<div>").addClass("summary-bits");

          if (checkBlocksErrored > 0 ) {
            summary_bits
              .append($("<div>").addClass("summary-bit summary-errored")
                .html("<span class='summary-count'>" + checkBlocksErrored + "</span> " + "<span class='summary-status'>blocks errored.</span>"));
          } else if (testsFailedAll > 0) {
            summary_bits
              .append($("<div>").addClass("summary-bit summary-failed")
                .html("<span class='summary-count'>" + testsFailedAll + "</span> <span class='summary-status'>" + TESTS(testsFailedAll) + " FAILED.</span>" +
                  (hasValidity(examplar_results) ? " <span class='summary-advice'>Your implementation is likely buggy.</span>" 
                                                 : "")));
          } else {
            summary_bits
              .append($("<div>").addClass("summary-bit summary-passed")
                .html("<span class='summary-count'>" + checkPassedAll + "</span> <span class='summary-status'>" + TESTS(checkPassedAll) + " PASSED</span>"));
          }

          let view_button_elt = document.createElement("button");
          this.view_button_elt = view_button_elt;
          view_button_elt.textContent = "Show Results";

          view_button_elt.addEventListener("click", function() {
            if (container.classList.contains("expanded")) {
              _this.hideTests();
            } else {
              _this.showTests();
            }
          });

          summary_bits.append(view_button_elt);

          examplar_summary.then(examplar_summary => {
            if (!examplar_summary.classList.contains("invalid") || checkBlocksErrored > 0) {
              $(summary).append(summary_bits);
            }
          });

          if (checkTotalAll > 0 || checkBlocksErrored > 0) {
            container.appendChild(summary);
          }

          let blockList = document.createElement("div");
          blockList.classList.add("test-file-blocks");
          skeletons.forEach(skeleton => blockList.appendChild(skeleton.container));
          container.appendChild(blockList);
          this.check_blocks_elt = blockList;
          this.container = container;
        }

        FileSkeleton.prototype.highlight = function highlight() {

        };

        FileSkeleton.prototype.refreshSnippets = function refreshSnippets() {

        };

        FileSkeleton.prototype.showTest = function showTest(test) {
          console.log("FileSkeleton.showTest", test);
        };

        FileSkeleton.prototype.showTests = function showTests() {
          this.view_button_elt.textContent = "Hide Results";
          this.container.classList.add("expanded");
        };

        FileSkeleton.prototype.hideTests = function hideTests() {
          this.view_button_elt.textContent = "Show Results";
          this.container.classList.remove("expanded");
        };

        FileSkeleton.prototype.vivify = function vivify(rendering) {
          console.log("FileSkeleton.vivify");
        };

        return FileSkeleton;
      }();

      var CheckBlockSkeleton = function () {
        function CheckBlockSkeleton(file, block) {
          var _this = this;

          // destructure the `block` pyret value
          let name          = get(block, "name");
          let loc           = get(block, "loc");
          let maybeError    = get(block, "maybe-err");
          let testResults   = get(block, "test-results");
          let keywordCheck  = get(block, "keyword-check");

          this.file = file;
          this.name = name;

          let testsPassing  = 0;
          let testsExecuted = 0;

          let tests = ffi.toArray(testResults).
            reverse().
            map(function(test) {
              let testSuccess = isTestSuccess(test);
              testsExecuted++;
              let skeleton;
              if (testSuccess) {
                testsPassing++;
                skeleton = new PassingTestSkeleton(_this, test, testsExecuted);
                testsPassedSkeletons.push(skeleton);
              } else {
                skeleton = new FailingTestSkeleton(_this, test, testsExecuted);
                testsFailedSkeletons.push(skeleton);
              }
              return skeleton;
            });

          let endedInError    = get(option, "is-some").app(maybeError);
          let allTestsPassing = testsPassing === testsExecuted;
          let error = endedInError ? get(maybeError, "value").val : undefined;

          let passing = testsPassing;
          let executed = testsExecuted;

          this.stats = {passed: passing, executed: executed, errored: endedInError};

          if (endedInError) {
            checkErroredSkeletons.push(this);
          }

          var container = document.createElement("div");
          var testList = document.createElement("div");
          var testFrag = document.createDocumentFragment();
          var header = document.createElement("header");
          var summary = document.createElement("span");

          this.file = file;
          this.tests = tests;

          if (!endedInError) {
            tests.forEach(test => testFrag.appendChild(test.container));
          }

          if (error !== undefined) {
            summary.textContent =
              "An unexpected error halted the " +
              (keywordCheck ? "check" : "examples") + "-block before Pyret was finished with it. "
              + "Some tests may not have run.";
            var errorTestsSummary = document.createTextNode("Before the unexpected error, " + testsExecuted + (testsExecuted === 0 ? " tests " : " test ") + "in this block ran" + (testsExecuted > 0 ? " (" + testsPassing + " passed):" : "."));
            testList.appendChild(errorTestsSummary);
          } else {
            summary.textContent = testsExecuted == 1 && testsPassing == 1 ? "The test in this block passed."
            // Only one test in block; it fails
            : testsExecuted == 1 && testsPassing == 0 ? "The test in this block failed." : testsExecuted == 0 ?
            //  Huh, a block with no tests?
            "There were no tests in this block!" : testsExecuted == testsPassing ?
            //  More than one test; all pass.
            "All " + testsExecuted + " tests in this block passed."
            //  More than one test; some pass
            : testsPassing + " out of " + testsExecuted + " tests passed in this block.";
          }

          testList.classList.add("check-block-tests");
          summary.classList.add("check-block-summary");

          header.classList.add("check-block-header");
          header.title = "Click to view test results.";
          header.appendChild(makeNameHandle(name, loc, error !== undefined ? "hsl(0, 100%, 85%)" : testsExecuted == testsPassing ? "hsl(88, 50%, 76%)" : "hsl(45, 100%, 85%)").anchor);

          container.classList.add("check-block");
          container.classList.add(error !== undefined ? "check-block-errored" : testsExecuted == testsPassing ? "check-block-success" : "check-block-failed");
          container.appendChild(header);
          testList.appendChild(testFrag);
          container.appendChild(summary);
          container.appendChild(testList);

          var tombstone = undefined;
          if (error !== undefined) {
            tombstone = document.createElement("div");
            tombstone.classList.add("check-block-error");
            tombstone.addEventListener("click", function (e) {
              _this.highlight();
            });
            this.renderable = error.exn;
            container.appendChild(tombstone);
            var richStack = get(loadLib, "internal")
              .enrichStack(error, get(loadLib, "internal").getModuleResultRealm(result));
            this.maybeStackLoc = outputUI.makeMaybeStackLoc(runtime, documents, srcloc, richStack);
            this.pyretStack = richStack;
          }

          header.addEventListener("click", function (e) {
            if (this.container.classList.contains("expanded"))
              this.hideTests();
            else
              this.showTests();
          }.bind(this));

          summary.addEventListener("click", function (e) {
            if (this.container.classList.contains("expanded"))
              this.hideTests();
            else
              this.showTests();
          }.bind(this));

          this.needRefreshing = new Array();
          this.container = container;
          this.tombstone = tombstone;
          this.testsPassed = passing;
          this.testsExecuted =  executed;
          this.encounteredError = endedInError;
        }

        CheckBlockSkeleton.prototype.highlight = function highlight() {
          if (this.tombstone === undefined)
            return;
          outputUI.clearEffects();
          lastHighlighted = this;
          lastHighlighted.tombstone.classList.add("highlights-active");
          if(this.rendering) {
            this.rendering.trigger('toggleHighlight');
            this.rendering.addClass('highlights-active');
          }
        };

        CheckBlockSkeleton.prototype.refreshSnippets = function refreshSnippets() {
          for (var i = 0; i < this.needRefreshing.length; i++) {
            this.needRefreshing[i].refresh();
          }
          this.needRefreshing = new Array();
        };

        CheckBlockSkeleton.prototype.showTest = function showTest(test) {
          if (expandedCheckBlock !== undefined)
            expandedCheckBlock.hideTests();
          expandedCheckBlock = this;
          this.file.showTests();
          this.container.classList.add("expanded");
          this.refreshSnippets();
          test.container.scrollIntoView(true);
          test.highlight();
        };

        CheckBlockSkeleton.prototype.showTests = function showTests() {
          if (expandedCheckBlock !== undefined)
            expandedCheckBlock.hideTests();
          expandedCheckBlock = this;
          this.container.classList.add("expanded");
          this.refreshSnippets();
        };

        CheckBlockSkeleton.prototype.hideTests = function hideTests() {
          this.container.classList.remove("expanded");
          var innerHighlights = $(this.container).find(".highlights-active");
          if(innerHighlights.length > 0)
            outputUI.clearEffects();
          outputUI.clearEffects();
          lastHighlighted = undefined;
        };

        /* Replace the placeholder for the error with the error rendering */
        CheckBlockSkeleton.prototype.vivify = function vivify(rendering) {
          if (this.tombstone === undefined) return;
          this.rendering = rendering;
          rendering[0].classList.add("compile-error");
          rendering[0].addEventListener("click", this.highlight);
          this.tombstone.appendChild(rendering[0]);
          var snippets = rendering.find(".CodeMirror");
          for (var i = 0; i < snippets.length; i++) {
            window.requestAnimationFrame(
              CodeMirror.prototype.refresh.bind(snippets[i].CodeMirror));
          }
        };

        return CheckBlockSkeleton;
      }();

      var checkBlocks = ffi.toArray(checkResults);

      let groupedCheckBlocks = groupBy(checkBlocks, function(block) {
        return get(get(block, "loc"), "source");
      });

      if (!groupedCheckBlocks.has("definitions://")) {
        groupedCheckBlocks.set("definitions://", []);
      }

      if (checkBlocks.length === 0 && examplarResults == null)
        return;

      var keywordCheck = false;
      var keywordExamples = false;
      for (var i = 0; i < checkBlocks.length; i++) {
        if (get(option, "is-some").app(get(checkBlocks[i], "maybe-err"))) {
          if (get(checkBlocks[i], "keyword-check")) keywordCheck = true;
          else keywordExamples = true;
        }
      }
      var blockType;
      if (keywordCheck && keywordExamples) {
        blockType = $("<span>")
          .append("testing (")
          .append($("<code>").text("check")).append(" or ").append($("<code>").text("examples"))
          .append(")");
      } else if (keywordExamples) {
        blockType = $("<span>").append($("<code>").text("examples"));
      } else {
        blockType = $("<span>").append($("<code>").text("check"));
      }

      var checkResultsContainer = document.createElement("div");
      checkResultsContainer.classList.add("test-results");
      try{

      for (var [file, blocks] of groupedCheckBlocks) {
        if (blocks.length == 0 && ((file == "definitions://" ? examplarResults : null) == null || examplarResults.wheat.length == 0)) continue;
        var skeleton = new FileSkeleton(file, blocks, (file == "definitions://" ? examplarResults : null));
        checkResultsContainer.appendChild(skeleton.container);
      }

      var checkPassedAll      = testsPassedSkeletons.length;
      var checkBlocksErrored  = checkErroredSkeletons.length;
      var checkTotalAll       = checkPassedAll + testsFailedSkeletons.length;

      var summary = $("<div>").addClass("check-block testing-summary");
      container.append($(checkResultsContainer));

      }catch(e){console.error(e);}

      // must be called on the pyret stack
      function vivifySkeleton(skeleton) {
        var error_to_html = errorUI.error_to_html;
        return runtime.pauseStack(function (restarter) {
          // the skeleton's pyretStack must already be enriched
          return error_to_html(runtime, documents, skeleton.renderable, skeleton.pyretStack, result).
            then(function(html) {
              skeleton.vivify(html);
            }).done(function () {restarter.resume(runtime.nothing)});
        });
      }

      return runtime.safeCall(
        function(){
          return runtime.eachLoop(runtime.makeFunction(function(i) {
            return vivifySkeleton(checkErroredSkeletons[i]);
          }), 0, checkErroredSkeletons.length);
        }, function(_) {
          return runtime.safeCall(function() {
            return runtime.eachLoop(runtime.makeFunction(function(i) {
              return vivifySkeleton(testsFailedSkeletons[i]);
            }), 0, testsFailedSkeletons.length);
            return runtime.nothing;
          }, function(_) {
            for(var i = 0; i < testsPassedSkeletons.length; i++)
              testsPassedSkeletons[i].vivify();
            checkResultsContainer.classList.add("check-results-done-rendering");
            return runtime.nothing;
          }, "drawCheckResults:vivifySkeleton:failures");
        }, "drawCheckResults:vivifySkeleton:errors");
    }

    return runtime.makeJSModuleReturn({
      drawCheckResults: drawCheckResults,
      jsonCheckResults: jsonCheckResults
    });
  }
})
