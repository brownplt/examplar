var FOLDER_MIME = "application/vnd.google-apps.folder";

class Batch {
  constructor() {
    this.empty = true;
    this.batch = gapi.client.newBatch();
  }

  add(name, req) {
    this.empty = false;
    this.batch.add(req, {'id': name});
  }

  post(name, path, params) {
    this.empty = false;
    this.batch.add(gapi.client.request({
      path: path,
      method: "POST",
      body: params,
    }), {'id': name});
  }

  run() {
    if (this.empty) {
      return Promise.resolve({});
    }
    return this.batch.then(function(result) {
      let results = {};
      for (let [name, response] of Object.entries(result.result)) {
        if (response.status != 200) {
          delete response.body;
          console.error("Could not load assignment.", {request: name, response: response});
        } else {
          results[name] = response.result;
        }
      }
      return results;
    })
  }
}

class GoogleAPI {
  /**
   *  Load the client library. Return a promise to allow .then() in caller
   */
  load = () => {
    return gwrap.load({name: 'drive',
      version: 'v3',
      reauth: {
        immediate: true
      }
    });
  }

  /**
   *  Sign in the user upon button click.
   */
  signIn = (event) => {
    return gwrap.load({name: 'drive',
      version: 'v3',
      reauth: {
        immediate: false
      }
    });
  }

  /**
   *  Sign out the user upon button click.
   */
  signOut = (event) => {
    throw "Can't sign out yet.";
  }

  createAppFolder = (appName) => {
    return window.gapi.client.drive.files.create({
      resource: {
        'name' : appName,
        'mimeType' : FOLDER_MIME
      }
    });
  }

  getAppFolderID = (appName) => {
    return window.gapi.client.drive.files.list({
      q: '("me" in owners) and not trashed and mimeType="application/vnd.google-apps.folder" and name ="' + appName + '"'
    });
  }

  getAppSharedFolderID = (appName) => {
    return window.gapi.client.drive.files.list({
      q: '("me" in owners) and not trashed and mimeType="application/vnd.google-apps.folder" and name ="' + appName + '.shared"'
    });
  }

  createNewFile = (parentFolderId, fileName) => {
    var reqOpts = {
      'path': '/drive/v3/files',
      'method': 'POST',
      'body': {
        'parents': [parentFolderId],
        'mimeType': 'text/plain',
        'name': fileName
      }
    };
    return window.gapi.client.request(reqOpts);
  }

  getRecentAssignments = (appName) => {
    function ls(q, fields) {
      fields = "nextPageToken,incompleteSearch," + (fields || "");
      var ret = Q.defer();
      var retrievePageOfFiles = function(request, result) {
        request.execute(function(resp) {
          result = result.concat(resp.result.files);
          var nextPageToken = resp.nextPageToken;
          if (resp.incompleteSearch && nextPageToken) {
            request = gapi.client.drive.files.list({
              'q': q,
              'fields': fields,
              'pageToken': nextPageToken
            });
            retrievePageOfFiles(request, result);
          } else {
            ret.resolve(result);
          }
        });
      }
      var initialRequest = gapi.client.drive.files.list({'q': q, 'fields': fields});
      retrievePageOfFiles(initialRequest, []);
      return ret.promise;
    }

    return this.getAppFolderID(appName).then(response => {
      const appFolder = response.result.files[0];
      // Check for nonexistent drive folder
      if (!appFolder) return Promise.resolve([]);

      const files = ls(`not trashed and "${appFolder.id}" in parents`,
        "files(properties(assignment))");
      return files.then(function (files) {
          files = [...new Set(files.map(f => f.properties.assignment))]
          let batch = new Batch();
          files.forEach(file => batch.add(file, gapi.client.drive.files.get({fileId: file})));
          return batch.run()
        }).then(function (result) {
          return Object.entries(result).map(([id, info]) => new Object({id: id, name: info.name}));
        });
    });
  }

  getRecentFilesByExtAndAppName = (appName, ext) => {
    return Q.all([this.getAppFolderID(appName), this.getAppSharedFolderID(appName)])
      .then((resp) => {
        var savedFiles = resp[0].result.files;
        var sharedFiles = resp[1].result.files;
        var isSharedFile = "(appProperties has {key=\'originalProgramFlag\' and value=\'true\'})";
        if(sharedFiles.length > 0) {
          isSharedFile += "or '" + sharedFiles[0].id + "' in parents";
        }
        if(savedFiles.length === 0) { return this.getRecentFilesByExt(ext); }
        else {
          return window.gapi.client.drive.files.list({
            fields: "files(id, name)",
            q: 'not trashed and properties has {key="examplar" and value="yes"} and not (' + isSharedFile + ') and (fileExtension="' + ext + '" or "' + savedFiles[0].id + '" in parents)',
          });
        }
      })
  }

  /**
   * list files w/ extension [ext].
   */
  getRecentFilesByExt = (ext) => {
    return window.gapi.client.drive.files.list({
      fields: "files(id, name)",
      q: 'not trashed and properties has {key="examplar" and value="yes"} and fileExtension="' + ext + '"',
    });
  }

  getAppDataFileID = (appDataFilename) => {
    return window.gapi.client.drive.files.list({
      q: 'not trashed and name="' + appDataFilename + '"',
      spaces: 'appDataFolder'
    });
  }

  createAppDataFile = (appDataFilename) => {
    return window.gapi.client.drive.files.create({
      resource: {
        name: appDataFilename,
        parents: ['appDataFolder']
      }
    });
  }

  getAppDataFileContent = (fileId) => {
    return window.gapi.client.drive.files.get({
      fileId: fileId,
      // Download a file — files.get with alt=media file resource
      alt: 'media'
    });
  }

  saveAppData = (fileId, appData) => {
    return window.gapi.client.drive.files.update({
      path: '/upload/drive/v3/files/' + fileId,
      method: 'PATCH',
      params: {
        uploadType: 'media'
      },
      body: JSON.stringify(appData)
    });
  }

  // Create and render a Google Picker object for selecting a file.
  createPicker = (appName, callback) => {
    window.gapi.load('picker', () => {
      this.getAppFolderID(appName).then((resp) => {
        var driveView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS).setIncludeFolders(true);
        if(resp.result.files.length !== 0) {
          driveView.setParent(resp.result.files[0].id);
        }
        window.picker = new window.google.picker.PickerBuilder()
          .setTitle("Select a Pyret document")
          .addView(driveView)
          .setOAuthToken(window.gapi.auth.getToken().access_token)
          .setCallback(callback)
          .setOrigin(window.location.protocol + '//' + window.location.host)
          .build();

        window.picker.setVisible(true);
      })
    });
  }

  getUsername = () => {
    return gwrap.load({name: 'plus',
      version: 'v1',
    }).then((api) => {
      console.log("Api: ", api);
      return api.people.get({ userId: "me" });
    });
  }
}

export default GoogleAPI;
