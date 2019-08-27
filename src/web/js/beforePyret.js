/* global $ jQuery CPO CodeMirror storageAPI Q createProgramCollectionAPI makeShareAPI */

var shareAPI = makeShareAPI(process.env.CURRENT_PYRET_RELEASE);

var FileSaver = require('file-saver');
var JSZip = require("jszip");
var url = require('url.js');
var modalPrompt = require('./modal-prompt.js');
window.modalPrompt = modalPrompt;

const LOG = true;
window.ct_log = function(/* varargs */) {
  if (window.console && LOG) {
    console.log.apply(console, arguments);
  }
};

window.ct_error = function(/* varargs */) {
  if (window.console && LOG) {
    console.error.apply(console, arguments);
  }
};
var initialParams = url.parse(document.location.href);
var params = url.parse("/?" + initialParams["hash"]);
window.highlightMode = "mcmh"; // what is this for?
window.clearFlash = function() {
  $(".notificationArea").empty();
}
window.whiteToBlackNotification = function() {
  /*
  $(".notificationArea .active").css("background-color", "white");
  $(".notificationArea .active").animate({backgroundColor: "#111111" }, 1000);
  */
};
window.stickError = function(message, more) {
  CPO.sayAndForget(message);
  clearFlash();
  var err = $("<span>").addClass("error").text(message);
  if(more) {
    err.attr("title", more);
  }
  err.tooltip();
  $(".notificationArea").prepend(err);
  whiteToBlackNotification();
};
window.flashError = function(message) {
  CPO.sayAndForget(message);
  clearFlash();
  var err = $("<span>").addClass("error").text(message);
  $(".notificationArea").prepend(err);
  whiteToBlackNotification();
  err.fadeOut(7000);
};
window.flashMessage = function(message) {
  CPO.sayAndForget(message);
  clearFlash();
  var msg = $("<span>").addClass("active").text(message);
  $(".notificationArea").prepend(msg);
  whiteToBlackNotification();
  msg.fadeOut(7000);
};
window.stickMessage = function(message) {
  CPO.sayAndForget(message);
  clearFlash();
  var err = $("<span>").addClass("active").text(message);
  $(".notificationArea").prepend(err);
  whiteToBlackNotification();
};
window.mkWarningUpper = function(){return $("<div class='warning-upper'>");}
window.mkWarningLower = function(){return $("<div class='warning-lower'>");}

$(window).bind("beforeunload", function() {
  return "Because this page can load slowly, and you may have outstanding changes, we ask that you confirm before leaving the editor in case closing was an accident.";
});

var Documents = function() {

  function Documents() {
    this.documents = new Map();
  }

  Documents.prototype.has = function (name) {
    return this.documents.has(name);
  };

  Documents.prototype.get = function (name) {
    return this.documents.get(name);
  };

  Documents.prototype.set = function (name, doc) {
    if(logger.isDetailed)
      logger.log("doc.set", {name: name, value: doc.getValue()});
    return this.documents.set(name, doc);
  };

  Documents.prototype.delete = function (name) {
    if(logger.isDetailed)
      logger.log("doc.del", {name: name});
    return this.documents.delete(name);
  };

  Documents.prototype.forEach = function (f) {
    return this.documents.forEach(f);
  };

  return Documents;
}();


var Tab = function() {

  let tab_bar = document.getElementById("files-tabs");

  function Tab(source) {
    this.source = source;

    let uri = "my-gdrive://" + source.name;
    CPO.tabs.set(source, this);

    let tab = document.createElement("li");
    this.tab = tab;

    tab.classList.add("tab");
    let anchor = document.createElement("a");
    anchor.innerText = source.name;
    anchor.href = "#";
    tab.appendChild(anchor);

    let activate = this.activate.bind(this)
    tab.addEventListener("click", function(e) {
      e.preventDefault();
      activate();
    });

    tab_bar.appendChild(tab);
  }

  Tab.prototype.activate = function () {
    document.querySelectorAll(".selected").forEach(tab => tab.classList.remove("selected"));
    CPO.editor.cm.swapDoc(this.source.document);
    this.tab.classList.add("selected");
  };

  return Tab;
}();

CodeMirror.defineDocExtension("clearDecorations", function() {
  let doc = this;
  let editor = doc.getEditor();

  try {
    if (editor != null) {
      editor.startOperation();
    }

    doc.clearGutter("test-marker-gutter");

    doc.eachLine(function(lh){
      doc.removeLineClass(lh, "background");});

    let marks = doc.getAllMarks();

    for(var i = 0; i < marks.length; i++) {
      if (marks[i].className === "import-marker") {
        continue;
      }
      marks[i].clear();
    }
  } finally {
    if (editor != null) {
      editor.endOperation();
    }
  }
});


var VERSION_CHECK_INTERVAL = 120000 + (30000 * Math.random());

function checkVersion() {
  $.get("/current-version").then(function(resp) {
    resp = JSON.parse(resp);
    if(resp.version && resp.version > Number(window.CURRENT_VERSION)) {
      window.stickMessage("A new version of Pyret is available. Save and reload the page to get the newest version.");
    }
  });
}
window.setInterval(checkVersion, VERSION_CHECK_INTERVAL);

window.CPO = {
  save: function() {},
  autoSave: function() {},
  documents : new Documents(),
  tabs: new Map(),
};

CPO.clearEditorDecorations = function() {
  document.getElementById("main").dataset.highlights = "";
  sourceAPI.loaded.forEach(source => source.document.clearDecorations());
  let sheet = document.getElementById("highlight-styles").sheet;
  for(var i=0; i< sheet.cssRules.length; i++) {
    sheet.deleteRule(i);
  }
};

$(function() {
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
  var animationDiv = null;
  function closeAnimationIfOpen() {
    if(animationDiv) {
      animationDiv.empty();
      animationDiv.dialog("destroy");
      animationDiv = null;
    }
  }
  CPO.makeEditor = function(container, options) {
    var initial = "";
    if (options.hasOwnProperty("initial")) {
      initial = options.initial;
    }

    var textarea = jQuery("<textarea aria-hidden='true'>");
    textarea.val(initial);
    container.append(textarea);

    var runFun = function (code, replOptions) {
      options.run(code, {cm: CM}, replOptions);
    };

    var useLineNumbers = !options.simpleEditor;
    var useFolding = !options.simpleEditor;

    var gutters = !options.simpleEditor ?
      ["CodeMirror-linenumbers", "CodeMirror-foldgutter"] :
      [];

    function reindentAllLines(cm) {
      var last = cm.lineCount();
      cm.operation(function() {
        for (var i = 0; i < last; ++i) cm.indentLine(i);
      });
    }

    // place a vertical line at character 80 in code editor, and not repl
    var CODE_LINE_WIDTH = 100;

    var rulers, rulersMinCol;
    if (options.simpleEditor) {
      rulers = [];
    } else{
      rulers = [{color: "#317BCF", column: CODE_LINE_WIDTH, lineStyle: "dashed", className: "hidden"}];
      rulersMinCol = CODE_LINE_WIDTH;
    }

    var cmOptions = {
      extraKeys: CodeMirror.normalizeKeyMap({
        "Shift-Enter": function(cm) { runFun(sourceAPI.get_loaded("definitions://").contents); },
        "Shift-Ctrl-Enter": function(cm) { runFun(sourceAPI.get_loaded("definitions://")); },
        "Tab": "indentAuto",
        "Ctrl-I": reindentAllLines,
        "Esc Left": "goBackwardSexp",
        "Alt-Left": "goBackwardSexp",
        "Esc Right": "goForwardSexp",
        "Alt-Right": "goForwardSexp",
        "Ctrl-Left": "goBackwardToken",
        "Ctrl-Right": "goForwardToken"
      }),
      indentUnit: 2,
      tabSize: 2,
      viewportMargin: Infinity,
      lineNumbers: useLineNumbers,
      matchKeywords: true,
      matchBrackets: true,
      styleSelectedText: true,
      foldGutter: useFolding,
      gutters: gutters,
      lineWrapping: true,
      logging: true,
      rulers: rulers,
      rulersMinCol: rulersMinCol
    };

    cmOptions = merge(cmOptions, options.cmOptions || {});

    var CM = CodeMirror.fromTextArea(textarea[0], cmOptions);

    if (useLineNumbers) {
      CM.display.wrapper.appendChild(mkWarningUpper()[0]);
      CM.display.wrapper.appendChild(mkWarningLower()[0]);
    }

    getTopTierMenuitems();

    return {
      cm: CM,
      refresh: function() { CM.refresh(); },
      run: function() {
        runFun(sourceAPI.get_loaded("definitions://"));
      },
      focus: function() { CM.focus(); },
      focusCarousel: null //initFocusCarousel
    };
  };
  CPO.RUN_CODE = function() {
    console.log("Running before ready", arguments);
  };

  function setUsername(target) {
    return gwrap.load({name: 'plus',
      version: 'v1',
    }).then((api) => {
      api.people.get({ userId: "me" }).then(function(user) {
        var name = user.displayName;
        if (user.emails && user.emails[0] && user.emails[0].value) {
          name = user.emails[0].value;
        }
        target.text(name);
      });
    });
  }

  storageAPI.then(function(api) {
    api.collection.then(function() {
      $(".loginOnly").show();
      $(".logoutOnly").hide();
      setUsername($("#username"));
    });
    api.collection.fail(function() {
      $(".loginOnly").hide();
      $(".logoutOnly").show();
    });
  });

  storageAPI = storageAPI.then(function(api) { return api.api; });

  window.sourceAPI = window.createSourceManager(storageAPI);
  CPO.sourceAPI = window.sourceAPI;

  let assignment;

  if (params["get"] && params["get"]["assignment"]) {
    assignment = storageAPI.then(api => api.getTemplateFileById(params["get"]["assignment"]));
  } else {
    // Redirect to main page.
    window.location.href = "/";
  }

  function setTitle(progName) {
    document.title = progName + " - code.pyret.org";
  }
  CPO.setTitle = setTitle;

  var filename = false;

  $("#download a").click(function() {
    var zip = new JSZip();

    sourceAPI.loaded
      .filter(s => !s.ephemeral && !s.shared)
      .forEach(s => zip.file(s.name, s.contents));

    Promise.all([zip.generateAsync({type:"blob"}), window.assignment_name])
      .then(function ([blob, name]) {
          FileSaver.saveAs(blob, name + ".zip");
      });
  });

  var TRUNCATE_LENGTH = 20;

  function truncateName(name) {
    if(name.length <= TRUNCATE_LENGTH + 1) { return name; }
    return name.slice(0, TRUNCATE_LENGTH / 2) + "…" + name.slice(name.length - TRUNCATE_LENGTH / 2, name.length);
  }

  function updateName(p) {
    if (p.assignment_name != null) {
      filename = p.assignment_name;
    } else {
      filename = p.getName();
    }
    $("#filename").text(" (" + truncateName(filename) + ")");
    setTitle(filename);
    showShareContainer(p);
  }

  function say(msg, forget) {
    if (msg === "") return;
    var announcements = document.getElementById("announcementlist");
    var li = document.createElement("LI");
    li.appendChild(document.createTextNode(msg));
    announcements.insertBefore(li, announcements.firstChild);
    if (forget) {
      setTimeout(function() {
        announcements.removeChild(li);
      }, 1000);
    }
  }

  function sayAndForget(msg) {
    //console.log('doing sayAndForget', msg);
    say(msg, true);
  }

  function cycleAdvance(currIndex, maxIndex, reverseP) {
    var nextIndex = currIndex + (reverseP? -1 : +1);
    nextIndex = ((nextIndex % maxIndex) + maxIndex) % maxIndex;
    return nextIndex;
  }

  function populateFocusCarousel(editor) {
    if (!editor.focusCarousel) {
      editor.focusCarousel = [];
    }
    var fc = editor.focusCarousel;
    var docmain = document.getElementById("main");
    if (!fc[0]) {
      var toolbar = document.getElementById('Toolbar');
      fc[0] = toolbar;
      //fc[0] = document.getElementById("headeronelegend");
      //getTopTierMenuitems();
      //fc[0] = document.getElementById('bonniemenubutton');
    }
    if (!fc[1]) {
      var docreplMain = docmain.getElementsByClassName("replMain");
      var docreplMain0;
      if (docreplMain.length === 0) {
        docreplMain0 = undefined;
      } else if (docreplMain.length === 1) {
        docreplMain0 = docreplMain[0];
      } else {
        for (var i = 0; i < docreplMain.length; i++) {
          if (docreplMain[i].innerText !== "") {
            docreplMain0 = docreplMain[i];
          }
        }
      }
      fc[1] = docreplMain0;
    }
    if (!fc[2]) {
      var docrepl = docmain.getElementsByClassName("repl");
      var docreplcode = docrepl[0].getElementsByClassName("prompt-container")[0].
        getElementsByClassName("CodeMirror")[0];
      fc[2] = docreplcode;
    }
    if (!fc[3]) {
      fc[3] = document.getElementById("announcements");
    }
  }

  function cycleFocus(reverseP) {
    //console.log('doing cycleFocus', reverseP);
    var editor = this.editor;
    populateFocusCarousel(editor);
    var fCarousel = editor.focusCarousel;
    var maxIndex = fCarousel.length;
    var currentFocusedElt = fCarousel.find(function(node) {
      if (!node) {
        return false;
      } else {
        return node.contains(document.activeElement);
      }
    });
    var currentFocusIndex = fCarousel.indexOf(currentFocusedElt);
    var nextFocusIndex = currentFocusIndex;
    var focusElt;
    do {
      nextFocusIndex = cycleAdvance(nextFocusIndex, maxIndex, reverseP);
      focusElt = fCarousel[nextFocusIndex];
      //console.log('trying focusElt', focusElt);
    } while (!focusElt);

    var focusElt0;
    if (focusElt.classList.contains('toolbarregion')) {
      //console.log('settling on toolbar region')
      getTopTierMenuitems();
      focusElt0 = document.getElementById('bonniemenubutton');
    } else if (focusElt.classList.contains("replMain") ||
      focusElt.classList.contains("CodeMirror")) {
      //console.log('settling on defn window')
      var textareas = focusElt.getElementsByTagName("textarea");
      //console.log('txtareas=', textareas)
      //console.log('txtarea len=', textareas.length)
      if (textareas.length === 0) {
        //console.log('I')
        focusElt0 = focusElt;
      } else if (textareas.length === 1) {
        //console.log('settling on inter window')
        focusElt0 = textareas[0];
      } else {
        //console.log('settling on defn window')
        /*
        for (var i = 0; i < textareas.length; i++) {
          if (textareas[i].getAttribute('tabIndex')) {
            focusElt0 = textareas[i];
          }
        }
        */
        focusElt0 = textareas[textareas.length-1];
        focusElt0.removeAttribute('tabIndex');
      }
    } else {
      //console.log('settling on announcement region', focusElt)
      focusElt0 = focusElt;
    }

    document.activeElement.blur();
    focusElt0.click();
    focusElt0.focus();
    //console.log('(cf)docactelt=', document.activeElement);
  }

  window.user = storageAPI.then(api => api.about()).then(about => about.user.emailAddress);
  window.assignment_id = assignment.then(function(assn) { return assn.assignment_id });
  window.assignment_name = assignment.then(function(assn) { return assn.assignment_name });

  let assignment_tests = assignment.then(assn => sourceAPI.from_file(assn.tests));
  let assignment_common = assignment.then(assn => sourceAPI.from_file(assn.common));

  window.dummy_impl = assignment.then(assn => assn.dummy_impl);

  // set `definitions://` to the test document
  assignment_tests.then(tests => sourceAPI.set_definitions(tests));

  // load the wheats
  window.wheat =
    assignment_id.then(function(id) {
      return storageAPI.then(function(api) {
        return api.getGrainFilesByTemplate(id,'wheat');
      });
    });

  // load the chaff
  window.chaff =
    assignment_id.then(function(id) {
      return storageAPI.then(function(api) {
        return api.getGrainFilesByTemplate(id,'chaff');
      });
    });

  let common_and_tests_tabs =
    Q.all([assignment_common, assignment_tests])
      .then(function ([common, tests]) {
        new Tab(common);
        new Tab(tests).activate();
        CPO.editor.cm.setOption('readOnly', false);
      });

  let maybe_code =
    Q.all([assignment.then(assn => assn.code), window.wheat]).then(function([code, wheat]) {
      if (wheat.length == 0) {
        // if no wheats, eagerly instantiate the code tab
        if (code instanceof Function) {
          return code()
            .then(code => sourceAPI.from_file(code))
            .then(code => new Tab(code));
        } else {
          return sourceAPI.from_file(code)
            .then(code => new Tab(code));
        }
      } else {
        // otherwise, lazy load
        if (code instanceof Function) {
          let begin_button = document.createElement("button");
          begin_button.textContent = "+ Begin Implementation";

          begin_button.addEventListener("click", function() {
            code().then(function(code) {
              begin_button.remove();
              sourceAPI.from_file(code).then(code => new Tab(code));
            });
          });

          document.getElementById("files-tabs-container")
            .appendChild(begin_button);
          return Q();
        } else {
          return sourceAPI.from_file(code).then(code => new Tab(code));
        }
      }
    });

  window.programLoaded = Q.all([common_and_tests_tabs, maybe_code])
    .then(function (p) {
      enableFileOptions();
      return p;
    });

  function showShareContainer(p) {
    //console.log('called showShareContainer');
    if(!p.shared) {
      $("#shareContainer").empty();
      $('#publishli').show();
      $("#shareContainer").append(shareAPI.makeShareLink(p));
      getTopTierMenuitems();
    }
  }

  function nameOrUntitled() {
    return filename || "Untitled";
  }
  function autoSave() {
    return save();
  }

  function enableFileOptions() {
    $("#filemenuContents *").removeClass("disabled");
  }

  function menuItemDisabled(id) {
    return $("#" + id).hasClass("disabled");
  }

  function newEvent(e) {
    window.open(window.APP_BASE_URL + "/editor");
  }

  function saveEvent(e) {
    if(menuItemDisabled("save")) { return; }
    return save();
  }

  /*
    save : string (optional) -> undef

    If a string argument is provided, create a new file with that name and save
    the editor contents in that file.

    If no filename is provided, save the existing file referenced by the editor
    with the current editor contents.  If no filename has been set yet, just
    set the name to "Untitled".

  */
  function save() {
    window.stickMessage("Saving...");
    return Promise.all(
      sourceAPI.loaded
        .filter(s => !s.ephemeral && !s.shared)
        .map(s => s.save()))
    .then(function(s) {
      window.flashMessage("Programs saved!");
      return s;
    }, function(e) {
      let message =
        (e && e.response && e.response.error && e.response.error.message) ? e.response.error.message : "Your internet connection may be down, or something else might be wrong with this site or saving to Google.  You should back up any changes to this program somewhere else.  You can try saving again to see if the problem was temporary, as well.";
      window.stickError("Unable to save", message);
      console.error("Unable to save:", e);
      throw e;
    });
  }

  $("#runButton").click(function() {
    CPO.autoSave();
  });

  $("#save").click(saveEvent);

  var focusableElts = $(document).find('#header .focusable');
  //console.log('focusableElts=', focusableElts)
  var theToolbar = $(document).find('#Toolbar');

  function getTopTierMenuitems() {
    //console.log('doing getTopTierMenuitems')
    var topTierMenuitems = $(document).find('#header ul li.topTier').toArray();
    topTierMenuitems = topTierMenuitems.
                        filter(elt => !(elt.style.display === 'none' ||
                                        elt.getAttribute('disabled') === 'disabled'));
    var numTopTierMenuitems = topTierMenuitems.length;
    for (var i = 0; i < numTopTierMenuitems; i++) {
      var ithTopTierMenuitem = topTierMenuitems[i];
      var iChild = $(ithTopTierMenuitem).children().first();
      //console.log('iChild=', iChild);
      iChild.find('.focusable').
        attr('aria-setsize', numTopTierMenuitems.toString()).
        attr('aria-posinset', (i+1).toString());
    }
    return topTierMenuitems;
  }

  function updateEditorHeight() {
    // Hide expanded menus so they don't factor into height
    hideAllTopMenuitems();
    var toolbarHeight = document.getElementById('topTierUl').scrollHeight;
    // gets bumped to 67 on initial resize perturbation, but actual value is indeed 40
    if (toolbarHeight < 80) toolbarHeight = 40;
    toolbarHeight += 'px';
    document.getElementById('REPL').style.paddingTop = toolbarHeight;
    var docMain = document.getElementById('main');
    var docReplMain = docMain.getElementsByClassName('replMain');
    if (docReplMain.length !== 0) {
      docReplMain[0].style.paddingTop = toolbarHeight;
    }
  }

  $(window).on('resize', updateEditorHeight);

  function insertAriaPos(submenu) {
    //console.log('doing insertAriaPos', submenu)
    var arr = submenu.toArray();
    //console.log('arr=', arr);
    var len = arr.length;
    for (var i = 0; i < len; i++) {
      var elt = arr[i];
      //console.log('elt', i, '=', elt);
      elt.setAttribute('aria-setsize', len.toString());
      elt.setAttribute('aria-posinset', (i+1).toString());
    }
  }


  document.addEventListener('click', function () {
    hideAllTopMenuitems();
  });

  theToolbar.click(function (e) {
    e.stopPropagation();
  });

  theToolbar.keydown(function (e) {
    //console.log('toolbar keydown', e);
    //most any key at all
    var kc = e.keyCode;
    if (kc === 27) {
      // escape
      hideAllTopMenuitems();
      //console.log('calling cycleFocus from toolbar')
      CPO.cycleFocus();
      e.stopPropagation();
    } else if (kc === 9 || kc === 37 || kc === 38 || kc === 39 || kc === 40) {
      // an arrow
      var target = $(this).find('[tabIndex=-1]');
      getTopTierMenuitems();
      document.activeElement.blur(); //needed?
      target.first().focus(); //needed?
      //console.log('docactelt=', document.activeElement);
      e.stopPropagation();
    } else {
      hideAllTopMenuitems();
    }
  });

  function clickTopMenuitem(e) {
    hideAllTopMenuitems();
    var thisElt = $(this);
    //console.log('doing clickTopMenuitem on', thisElt);
    var topTierUl = thisElt.closest('ul[id=topTierUl]');
    if (thisElt[0].hasAttribute('aria-hidden')) {
      return;
    }
    if (thisElt[0].getAttribute('disabled') === 'disabled') {
      return;
    }
    //var hiddenP = (thisElt[0].getAttribute('aria-expanded') === 'false');
    //hiddenP always false?
    var thisTopMenuitem = thisElt.closest('li.topTier');
    //console.log('thisTopMenuitem=', thisTopMenuitem);
    var t1 = thisTopMenuitem[0];
    var submenuOpen = (thisElt[0].getAttribute('aria-expanded') === 'true');
    if (!submenuOpen) {
      //console.log('hiddenp true branch');
      hideAllTopMenuitems();
      thisTopMenuitem.children('ul.submenu').attr('aria-hidden', 'false').show();
      thisTopMenuitem.children().first().find('[aria-expanded]').attr('aria-expanded', 'true');
    } else {
      //console.log('hiddenp false branch');
      thisTopMenuitem.children('ul.submenu').attr('aria-hidden', 'true').hide();
      thisTopMenuitem.children().first().find('[aria-expanded]').attr('aria-expanded', 'false');
    }
    e.stopPropagation();
  }

  var expandableElts = $(document).find('#header [aria-expanded]');
  expandableElts.click(clickTopMenuitem);

  function hideAllTopMenuitems() {
    //console.log('doing hideAllTopMenuitems');
    var topTierUl = $(document).find('#header ul[id=topTierUl]');
    topTierUl.find('[aria-expanded]').attr('aria-expanded', 'false');
    topTierUl.find('ul.submenu').attr('aria-hidden', 'true').hide();
  }

  var nonexpandableElts = $(document).find('#header .topTier > div > button:not([aria-expanded])');
  nonexpandableElts.click(hideAllTopMenuitems);

  function switchTopMenuitem(destTopMenuitem, destElt) {
    //console.log('doing switchTopMenuitem', destTopMenuitem, destElt);
    //console.log('dtmil=', destTopMenuitem.length);
    hideAllTopMenuitems();
    if (destTopMenuitem && destTopMenuitem.length !== 0) {
      var elt = destTopMenuitem[0];
      var eltId = elt.getAttribute('id');
      destTopMenuitem.children('ul.submenu').attr('aria-hidden', 'false').show();
      destTopMenuitem.children().first().find('[aria-expanded]').attr('aria-expanded', 'true');
    }
    if (destElt) {
      //destElt.attr('tabIndex', '0').focus();
      destElt.focus();
    }
  }

  var showingHelpKeys = false;

  function showHelpKeys() {
    showingHelpKeys = true;
    $('#help-keys').fadeIn(100);
    reciteHelp();
  }

  focusableElts.keydown(function (e) {
    //console.log('focusable elt keydown', e);
    var kc = e.keyCode;
    //$(this).blur(); // Delete?
    var withinSecondTierUl = true;
    var topTierUl = $(this).closest('ul[id=topTierUl]');
    var secondTierUl = $(this).closest('ul.submenu');
    if (secondTierUl.length === 0) {
      withinSecondTierUl = false;
    }
    if (kc === 27) {
      //console.log('escape pressed i')
      $('#help-keys').fadeOut(500);
    }
    if (kc === 27 && withinSecondTierUl) { // escape
      var destTopMenuitem = $(this).closest('li.topTier');
      var possElts = destTopMenuitem.find('.focusable:not([disabled])').filter(':visible');
      switchTopMenuitem(destTopMenuitem, possElts.first());
      e.stopPropagation();
    } else if (kc === 39) { // rightarrow
      //console.log('rightarrow pressed');
      var srcTopMenuitem = $(this).closest('li.topTier');
      //console.log('srcTopMenuitem=', srcTopMenuitem);
      srcTopMenuitem.children().first().find('.focusable').attr('tabIndex', '-1');
      var topTierMenuitems = getTopTierMenuitems();
      //console.log('ttmi* =', topTierMenuitems);
      var ttmiN = topTierMenuitems.length;
      var j = topTierMenuitems.indexOf(srcTopMenuitem[0]);
      //console.log('j initial=', j);
      for (var i = (j + 1) % ttmiN; i !== j; i = (i + 1) % ttmiN) {
        var destTopMenuitem = $(topTierMenuitems[i]);
        //console.log('destTopMenuitem(a)=', destTopMenuitem);
        var possElts = destTopMenuitem.find('.focusable:not([disabled])').filter(':visible');
        //console.log('possElts=', possElts)
        if (possElts.length > 0) {
          //console.log('final i=', i);
          //console.log('landing on', possElts.first());
          switchTopMenuitem(destTopMenuitem, possElts.first());
          e.stopPropagation();
          break;
        }
      }
    } else if (kc === 37) { // leftarrow
      //console.log('leftarrow pressed');
      var srcTopMenuitem = $(this).closest('li.topTier');
      //console.log('srcTopMenuitem=', srcTopMenuitem);
      srcTopMenuitem.children().first().find('.focusable').attr('tabIndex', '-1');
      var topTierMenuitems = getTopTierMenuitems();
      //console.log('ttmi* =', topTierMenuitems);
      var ttmiN = topTierMenuitems.length;
      var j = topTierMenuitems.indexOf(srcTopMenuitem[0]);
      //console.log('j initial=', j);
      for (var i = (j + ttmiN - 1) % ttmiN; i !== j; i = (i + ttmiN - 1) % ttmiN) {
        var destTopMenuitem = $(topTierMenuitems[i]);
        //console.log('destTopMenuitem(b)=', destTopMenuitem);
        //console.log('i=', i)
        var possElts = destTopMenuitem.find('.focusable:not([disabled])').filter(':visible');
        //console.log('possElts=', possElts)
        if (possElts.length > 0) {
          //console.log('final i=', i);
          //console.log('landing on', possElts.first());
          switchTopMenuitem(destTopMenuitem, possElts.first());
          e.stopPropagation();
          break;
        }
      }
    } else if (kc === 38) { // uparrow
      //console.log('uparrow pressed');
      var submenu;
      if (withinSecondTierUl) {
        var nearSibs = $(this).closest('div').find('.focusable').filter(':visible');
        //console.log('nearSibs=', nearSibs);
        var myId = $(this)[0].getAttribute('id');
        //console.log('myId=', myId);
        submenu = $([]);
        var thisEncountered = false;
        for (var i = nearSibs.length - 1; i >= 0; i--) {
          if (thisEncountered) {
            //console.log('adding', nearSibs[i]);
            submenu = submenu.add($(nearSibs[i]));
          } else if (nearSibs[i].getAttribute('id') === myId) {
            thisEncountered = true;
          }
        }
        //console.log('submenu so far=', submenu);
        var farSibs = $(this).closest('li').prevAll().find('div:not(.disabled)')
          .find('.focusable').filter(':visible');
        submenu = submenu.add(farSibs);
        if (submenu.length === 0) {
          submenu = $(this).closest('li').closest('ul').find('div:not(.disabled)')
          .find('.focusable').filter(':visible').last();
        }
        if (submenu.length > 0) {
          submenu.last().focus();
        } else {
          /*
          //console.log('no actionable submenu found')
          var topmenuItem = $(this).closest('ul.submenu').closest('li')
          .children().first().find('.focusable:not([disabled])').filter(':visible');
          if (topmenuItem.length > 0) {
            topmenuItem.first().focus();
          } else {
            //console.log('no actionable topmenuitem found either')
          }
          */
        }
      }
      e.stopPropagation();
    } else if (kc === 40) { // downarrow
      //console.log('downarrow pressed');
      var submenuDivs;
      var submenu;
      if (!withinSecondTierUl) {
        //console.log('1st tier')
        submenuDivs = $(this).closest('li').children('ul').find('div:not(.disabled)');
        submenu = submenuDivs.find('.focusable').filter(':visible');
        insertAriaPos(submenu);
      } else {
        //console.log('2nd tier')
        var nearSibs = $(this).closest('div').find('.focusable').filter(':visible');
        //console.log('nearSibs=', nearSibs);
        var myId = $(this)[0].getAttribute('id');
        //console.log('myId=', myId);
        submenu = $([]);
        var thisEncountered = false;
        for (var i = 0; i < nearSibs.length; i++) {
          if (thisEncountered) {
            //console.log('adding', nearSibs[i]);
            submenu = submenu.add($(nearSibs[i]));
          } else if (nearSibs[i].getAttribute('id') === myId) {
            thisEncountered = true;
          }
        }
        //console.log('submenu so far=', submenu);
        var farSibs = $(this).closest('li').nextAll().find('div:not(.disabled)')
          .find('.focusable').filter(':visible');
        submenu = submenu.add(farSibs);
        if (submenu.length === 0) {
          submenu = $(this).closest('li').closest('ul').find('div:not(.disabled)')
            .find('.focusable').filter(':visible');
        }
      }
      //console.log('submenu=', submenu)
      if (submenu.length > 0) {
        submenu.first().focus();
      } else {
        //console.log('no actionable submenu found')
      }
      e.stopPropagation();
    } else if (kc === 27) {
      //console.log('esc pressed');
      hideAllTopMenuitems();
      if (showingHelpKeys) {
        showingHelpKeys = false;
      } else {
        //console.log('calling cycleFocus ii')
        CPO.cycleFocus();
      }
      e.stopPropagation();
      e.preventDefault();
      //$(this).closest('nav').closest('main').focus();
    } else if (kc === 9 ) {
      if (e.shiftKey) {
        hideAllTopMenuitems();
        CPO.cycleFocus(true);
      }
      e.stopPropagation();
      e.preventDefault();
    } else if (kc === 13 || kc === 17 || kc === 20 || kc === 32) {
      // 13=enter 17=ctrl 20=capslock 32=space
      //console.log('stopprop 1')
      e.stopPropagation();
    } else if (kc >= 112 && kc <= 123) {
      //console.log('doprop 1')
      // fn keys
      // go ahead, propagate
    } else if (e.ctrlKey && kc === 191) {
      //console.log('C-? pressed')
      showHelpKeys();
      e.stopPropagation();
    } else {
      //console.log('stopprop 2')
      e.stopPropagation();
    }
    //e.stopPropagation();
  });

  // shareAPI.makeHoverMenu($("#filemenu"), $("#filemenuContents"), false, function(){});
  // shareAPI.makeHoverMenu($("#bonniemenu"), $("#bonniemenuContents"), false, function(){});


  var codeContainer = $("<div>").addClass("replMain");
  codeContainer.attr("role", "region").
    attr("aria-label", "Definitions");
    //attr("tabIndex", "-1");
  $("#main").prepend(codeContainer);

  CPO.editor = CPO.makeEditor(codeContainer, {
    runButton: $("#runButton"),
    simpleEditor: false,
    run: CPO.RUN_CODE,
    initialGas: 100
  });
  CPO.editor.cm.setOption("readOnly", "nocursor");
  CPO.editor.cm.setOption("longLines", new Map());
  function removeShortenedLine(lineHandle) {
    var rulers = CPO.editor.cm.getOption("rulers");
    var rulersMinCol = CPO.editor.cm.getOption("rulersMinCol");
    var longLines = CPO.editor.cm.getOption("longLines");
    if (lineHandle.text.length <= rulersMinCol) {
      lineHandle.rulerListeners.forEach((f, evt) => lineHandle.off(evt, f));
      longLines.delete(lineHandle);
      // console.log("Removed ", lineHandle);
      refreshRulers();
    }
  }
  function deleteLine(lineHandle) {
    var longLines = CPO.editor.cm.getOption("longLines");
    lineHandle.rulerListeners.forEach((f, evt) => lineHandle.off(evt, f));
    longLines.delete(lineHandle);
    // console.log("Removed ", lineHandle);
    refreshRulers();
  }
  function refreshRulers() {
    var rulers = CPO.editor.cm.getOption("rulers");
    var longLines = CPO.editor.cm.getOption("longLines");
    var minLength;
    if (longLines.size === 0) {
      minLength = 0; // if there are no long lines, then we don't care about showing any rulers
    } else {
      minLength = Number.MAX_VALUE;
      longLines.forEach(function(lineNo, lineHandle) {
        if (lineHandle.text.length < minLength) { minLength = lineHandle.text.length; }
      });
    }
    for (var i = 0; i < rulers.length; i++) {
      if (rulers[i].column >= minLength) {
        rulers[i].className = "hidden";
      } else {
        rulers[i].className = undefined;
      }
    }
    // gotta set the option twice, or else CM short-circuits and ignores it
    CPO.editor.cm.setOption("rulers", undefined);
    CPO.editor.cm.setOption("rulers", rulers);
  }
  CPO.editor.cm.on('changes', function(instance, changeObjs) {
    var minLine = instance.lastLine(), maxLine = 0;
    var rulersMinCol = instance.getOption("rulersMinCol");
    var longLines = instance.getOption("longLines");
    changeObjs.forEach(function(change) {
      if (minLine > change.from.line) { minLine = change.from.line; }
      if (maxLine < change.from.line + change.text.length) { maxLine = change.from.line + change.text.length; }
    });
    var changed = false;
    instance.eachLine(minLine, maxLine, function(lineHandle) {
      if (lineHandle.text.length > rulersMinCol) {
        if (!longLines.has(lineHandle)) {
          changed = true;
          longLines.set(lineHandle, lineHandle.lineNo());
          lineHandle.rulerListeners = new Map([
            ["change", removeShortenedLine],
            ["delete", function() { // needed because the delete handler gets no arguments at all
              deleteLine(lineHandle);
            }]
          ]);
          lineHandle.rulerListeners.forEach((f, evt) => lineHandle.on(evt, f));
          // console.log("Added ", lineHandle);
        }
      } else {
        if (longLines.has(lineHandle)) {
          changed = true;
          longLines.delete(lineHandle);
          // console.log("Removed ", lineHandle);
        }
      }
    });
    if (changed) {
      refreshRulers();
    }
  });

  //programLoaded.then(function(doc) {
  //  CPO.editor.cm.setOption('readOnly', false);
  //  CPO.editor.cm.swapDoc(doc);
  //});
  //
  //programLoaded.fail(function(error) {
  //  window.stickError("Unable to load program.", error.toString());
  //});

  var pyretLoad = document.createElement('script');
  console.log(process.env.PYRET);
  pyretLoad.src = process.env.PYRET;
  pyretLoad.type = "text/javascript";
  document.body.appendChild(pyretLoad);

  var pyretLoad2 = document.createElement('script');

  function logFailureAndManualFetch(url, e) {

    // NOTE(joe): The error reported by the "error" event has essentially no
    // information on it; it's just a notification that _something_ went wrong.
    // So, we log that something happened, then immediately do an AJAX request
    // call for the same URL, to see if we can get more information. This
    // doesn't perfectly tell us about the original failure, but it's
    // something.

    // In addition, if someone is seeing the Pyret failed to load error, but we
    // don't get these logging events, we have a strong hint that something is
    // up with their network.
    logger.log('pyret-load-failure',
      {
        event : 'initial-failure',
        url : url,

        // The timestamp appears to count from the beginning of page load,
        // which may approximate download time if, say, requests are timing out
        // or getting cut off.

        timeStamp : e.timeStamp
      });

    var manualFetch = $.ajax(url);
    manualFetch.then(function(res) {
      // Here, we log the first 100 characters of the response to make sure
      // they resemble the Pyret blob
      logger.log('pyret-load-failure', {
        event : 'success-with-ajax',
        contentsPrefix : res.slice(0, 100)
      });
    });
    manualFetch.fail(function(res) {
      logger.log('pyret-load-failure', {
        event : 'failure-with-ajax',
        status: res.status,
        statusText: res.statusText,
        // Since responseText could be a long error page, and we don't want to
        // log huge pages, we slice it to 100 characters, which is enough to
        // tell us what's going on (e.g. AWS failure, network outage).
        responseText: res.responseText.slice(0, 100)
      });
    });
  }

  $(pyretLoad).on("error", function(e) {
    logFailureAndManualFetch(process.env.PYRET, e);
    console.log(process.env);
    pyretLoad2.src = process.env.PYRET_BACKUP;
    pyretLoad2.type = "text/javascript";
    document.body.appendChild(pyretLoad2);
  });

  $(pyretLoad2).on("error", function(e) {
    $("#loader").hide();
    $("#runPart").hide();
    $("#breakButton").hide();
    window.stickError("Pyret failed to load; check your connection or try refreshing the page.  If this happens repeatedly, please report it as a bug.");
    logFailureAndManualFetch(process.env.PYRET_BACKUP, e);

  });

  //programLoaded.fin(function() {
  //  CPO.editor.focus();
  //});

  CPO.autoSave = autoSave;
  CPO.save = save;
  CPO.updateName = updateName;
  CPO.showShareContainer = showShareContainer;
  CPO.cycleFocus = cycleFocus;
  CPO.say = say;
  CPO.sayAndForget = sayAndForget;

});
