window.createSourceManager = function createSourceManager(storageAPI) {

  // pyret(ephemeral, shared, owned)

  // if pyret, then has associated CM doc

  class FileSource {
    constructor(file, contents) {
      this.file = file;
      this.document = CodeMirror.Doc(contents || "", "pyret");
    }

    get ephemeral() {
      return false;
    }

    get shared() {
      return this.file.shared;
    }

    get name() {
      return this.file.getName();
    }

    get contents() {
      return this.document.getValue();
    }

    save() {
      let _this = this;
      // examplar will _not_ eat your homework
      if (this.contents.trim() == "") {
        return Promise.reject("I'm sorry Dave, I'm afraid I can't do that.");
      }
      return this.file.save(this.contents, false)
        .then(function (f) {
          _this.file = f;
          return;
        });
    }
  }

  class EphemeralSource {
    constructor(name, doc) {
      this._name = name;
      this.document = doc;
    }

    get ephemeral() {
      return true;
    }

    get name() {
      return this._name;
    }

    get contents() {
      return this.document.getValue();
    }

    save() {}
  }

  // filename -> Source
  // "interactions://1"
  // "definitions://"
  let sources_by_filename = new Map();

  return {
    from_doc: function(name, doc) {
      let source = new EphemeralSource(name, doc);
      sources_by_filename.set(name, source);
      return source;
    },

    // consumes a File and produces a promise for a FileSource
    from_file: function(file) {
      let uri = file.getURI();

      if (sources_by_filename.has(uri)) {
        return Q(sources_by_filename.get(uri));
      }

      return file.getContents()
        .then(function(contents) {
          if (sources_by_filename.has(uri)) {
            return Q(sources_by_filename.get(uri));
          }
          let source = new FileSource(file, contents);
          sources_by_filename.set(uri, source);
          return source;
        });
    },

    set_definitions: function(source) {
      sources_by_filename.set("definitions://", source);
    },

    get loaded() {
      return Array.from(sources_by_filename.values())
    },

    get unique_loaded() {
      return Array.from(new Set(this.loaded));
    },

    is_loaded: function(name) {
      return sources_by_filename.has(name);
    },

    get_loaded: function(name) {
      return sources_by_filename.get(name);
    },

    // somethingelse.arr
    from_filename: function(name) {
      if (sources_by_filename.has(name)) {
        return Q(sources_by_filename.get(name));
      }

      if (name.startsWith("definitions://") || name.startsWith("interactions://")) {
        throw `{name} not found`;
      }

      return storageAPI
        .then(api => api.getFileByName(name))
        .then(files => files[0])
        .then(this.from_file);
      
    }
  };
};