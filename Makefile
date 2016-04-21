# NOTE: Needs TWO blank lines here, dunno why
define \n


endef
ifneq ($(findstring .exe,$(SHELL)),)
	override SHELL:=$(COMSPEC)$(ComSpec)
	MKDIR = $(foreach dir,$1,if not exist "$(dir)". (md "$(dir)".)$(\n))
	RMDIR = $(foreach dir,$1,if exist "$(dir)". (rd /S /Q "$(dir)".)$(\n))
	RM = if exist "$1". (del $1)
else
	MKDIR = mkdir -p $1
	RMDIR = rm -rf $1
	RM = rm -f $1
endif

CM=node_modules/codemirror

build/web/js/pyret.js.gz:
	gzip -9 node_modules/pyret-lang/build/phase0/pyret.js -c > build/web/js/pyret.js.gz

.PHONY : post-install
post-install: compress-pyret

install-link:
	npm link pyret-lang

.PHONY : selenium-test-local
selenium-test-local:
	TEST_LOC="local" node test/test.js test/browser

.PHONY : selenium-test-sauce
selenium-test-sauce:
	TEST_LOC="sauce" node test/test.js test/browser/pyret


OUT_HTML := $(patsubst src/web/%.template.html,build/web/views/%.html,$(wildcard src/web/*.template.html))

build/web/views/%.html: src/web/%.template.html
	node make-template.js $< > $@

COPY_HTML := $(patsubst src/web/%.html,build/web/views/%.html,$(wildcard src/web/*.html))

build/web/views/%.html: src/web/%.html
	cp $< $@

OUT_CSS := $(patsubst src/web/%.template.css,build/web/%.css,$(wildcard src/web/css/*.template.css))

build/web/css/%.css: src/web/css/%.template.css
	node make-template.js $< > $@

COPY_CSS := $(patsubst src/web/%.css,build/web/%.css,$(wildcard src/web/css/*.css))

build/web/css/%.css: src/web/css/%.css
	cp $< $@

COPY_NEW_CSS := $(patsubst src/web/%.css,build/web/%.css,$(wildcard src/web/neweditor/css/*.css))

build/web/neweditor/css/%.css: src/web/neweditor/css/%.css
	cp $< $@

COPY_NEW_JS := $(patsubst src/web/%.js,build/web/%.js,$(wildcard src/web/neweditor/js/*.js))

build/web/neweditor/js/%.js: src/web/neweditor/js/%.js
	cp $< $@

build/web/css/codemirror.css: $(CM)/lib/codemirror.css
	cp $< $@

MISC_CSS = build/web/css/codemirror.css

COPY_GIF := $(patsubst src/web/img/%.gif,build/web/img/%.gif,$(wildcard src/web/img/*.gif))

build/web/img/%.gif: src/web/img/%.gif
	cp $< $@

COPY_JS := $(patsubst src/web/js/%.js,build/web/js/%.js,$(wildcard src/web/js/*.js))

build/web/js/%.js: src/web/js/%.js
	cp $< $@

build/web/js/q.js: node_modules/q/q.js
	cp $< $@

build/web/js/s-expression-lib.js: node_modules/s-expression/index.js
	cp $< $@
	
build/web/js/colorspaces.js: node_modules/colorspaces/colorspaces.js
	cp $< $@

build/web/js/es6-shim.js: node_modules/es6-shim/es6-shim.min.js
	cp $< $@

build/web/js/seedrandom.js: node_modules/seedrandom/seedrandom.js
	cp $< $@

build/web/js/url.js: node_modules/url.js/url.js
	cp $< $@

build/web/js/require.js: node_modules/requirejs/require.js
	cp $< $@

build/web/js/codemirror.js: $(CM)/lib/codemirror.js
	cp $< $@
	
build/web/js/mark-selection.js: $(CM)/addon/selection/mark-selection.js
	cp $< $@

build/web/js/runmode.js: $(CM)/addon/runmode/runmode.js
	cp $< $@

build/web/js/pyret-fold.js: src/web/js/codemirror/pyret-fold.js
	cp $< $@

build/web/js/matchkw.js: src/web/js/codemirror/matchkw.js
	cp $< $@

build/web/js/pyret-mode.js: src/web/js/codemirror/pyret-mode.js
	cp $< $@

MISC_JS = build/web/js/q.js build/web/js/url.js build/web/js/require.js \
          build/web/js/codemirror.js \
          build/web/js/mark-selection.js \
          build/web/js/pyret-mode.js build/web/js/s-expression-lib.js \
          build/web/js/seedrandom.js \
          build/web/js/pyret-fold.js \
          build/web/js/matchkw.js \
          build/web/js/colorspaces.js \
          build/web/js/es6-shim.js \
          build/web/js/runmode.js

MISC_IMG = build/web/img/pyret-icon.png build/web/img/pyret-logo.png build/web/img/pyret-spin.gif build/web/img/up-arrow.png build/web/img/down-arrow.png

build/web/img/%: node_modules/pyret-lang/img/%
	cp $< $@

COPY_ARR := $(patsubst node_modules/pyret-lang/src/arr/base/%.arr,build/web/arr/base/%.arr,$(wildcard node_modules/pyret-lang/src/arr/base/*.arr))

build/web/arr/base/%: node_modules/pyret-lang/src/arr/base/%
	cp $< $@


WEB = build/web
WEBV = build/web/views
WEBJS = build/web/js
WEBCSS = build/web/css
WEBIMG = build/web/img
WEBARR = build/web/arr/base
NEWCSS = build/web/neweditor/css
NEWJS = build/web/neweditor/js

$(WEBV):
	@$(call MKDIR,$(WEBV))

$(WEB):
	@$(call MKDIR,$(WEB))

$(WEBJS):
	@$(call MKDIR,$(WEBJS))

$(WEBCSS):
	@$(call MKDIR,$(WEBCSS))

$(WEBIMG):
	@$(call MKDIR,$(WEBIMG))

$(WEBARR):
	@$(call MKDIR,$(WEBARR))

$(NEWCSS):
	@$(call MKDIR,$(NEWCSS))

$(NEWJS):
	@$(call MKDIR,$(NEWJS))

web-local: $(WEB) $(WEBV) $(WEBJS) $(WEBCSS) $(WEBIMG) $(WEBARR) $(NEWCSS) $(NEWJS) $(OUT_HTML) $(COPY_HTML) $(OUT_CSS) $(COPY_CSS) $(COPY_JS) $(COPY_ARR) $(COPY_GIF) build/web/js/pyret.js.gz $(MISC_JS) $(MISC_CSS) $(MISC_IMG) $(COPY_NEW_CSS) $(COPY_NEW_JS)

web: $(WEB) $(WEBV) $(WEBJS) $(WEBCSS) $(WEBIMG) $(WEBARR) $(NEWCSS) $(NEWJS) $(OUT_HTML) $(COPY_HTML) $(OUT_CSS) $(COPY_CSS) $(COPY_JS) $(COPY_ARR) $(COPY_GIF) build/web/js/pyret.js.gz $(MISC_JS) $(MISC_CSS) $(MISC_IMG) $(COPY_NEW_CSS) $(COPY_NEW_JS)

clean:
	rm -rf build/
