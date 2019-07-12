window.createSourceManager = function createSourceManager(storageAPI) {

  // pyret(ephemeral, shared, owned)

  // if pyret, then has associated CM doc

  class FileSource {
    constructor(file, contents) {
      this.file = file;
      this.document = CodeMirror.Doc(contents || "", "pyret");
    }

    get name() {
      return this.file.getName();
    }

    get contents() {
      return this.document.getValue();
    }

    save() {
      return this.file.save(this.contents, false);
    }
  }

  class EphemeralSource {
    constructor(name, doc) {
      this._name = name;
      this.document = doc;
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
      console.info("from_file", file);

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

    is_loaded: function(name) {
      console.info("is_loaded", name);
      return sources_by_filename.has(name);
    },

    get_loaded: function(name) {
      console.info("get_loaded", name);
      return sources_by_filename.get(name);
    },

    // somethingelse.arr
    from_filename: function(name) {
      console.info("from_filename", name);

      if (sources_by_filename.has(name)) {
        return Q(sources_by_filename.get(name));
      }

      if (name.startsWith("definitions://") || name.startsWith("interactions://")) {
        throw `{name} not found`;
      }

      return storageAPI
        .then(api => api.getFileByName(name))
        .then(function(file) {
          if (sources_by_filename.has(name)) {
            return Q(sources_by_filename.get(name));
          }
          return file.getContents();
        })
        .then(this.from_file);
      
    }
  };
};