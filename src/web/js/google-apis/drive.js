window.createProgramCollectionAPI = function createProgramCollectionAPI(collectionName, immediate) {
  function DriveError(err) {
    this.err = err;
  }
  DriveError.prototype = Error.prototype;
  var drive;
  var SCOPE = "https://www.googleapis.com/auth/drive.file "
    + "https://spreadsheets.google.com/feeds "
    + "https://www.googleapis.com/auth/drive.appdata "
    + "https://www.googleapis.com/auth/drive.install";
  var FOLDER_MIME =  "application/vnd.google-apps.folder";
  var BACKREF_KEY = "originalProgram";
  var PUBLIC_LINK = "pubLink";

  function createAPI(baseCollection) {
    function makeSharedFile(googFileObject, fetchFromGoogle) {
      return {
        shared: true,
        getOriginal: function() {
          var request = gapi.client.drive.properties.get({
            'fileId': googFileObject.id,
            'propertyKey': BACKREF_KEY,
            'visibility': 'PRIVATE'
          });
          return request;
        },
        getContents: function() {
          if(fetchFromGoogle) {
            // NOTE(joe): See https://developers.google.com/drive/v2/web/manage-downloads
            // The `selfLink` field directly returns the resource URL for the file, and
            // this will work as long as the file is public on the web.
            var reqUrl = googFileObject.selfLink;
            return Q($.get(reqUrl, {
              alt: "media",
              key: apiKey
            }));
          }
          else {
            return Q($.ajax("/shared-program-contents?sharedProgramId=" + googFileObject.id, {
              method: "get",
              dataType: "text"
            }));
          }
        },
        getName: function() {
          return googFileObject.title;
        },
        getURI: function() {
          return "shared-gdrive://" + googFileObject.title + ":" + googFileObject.id;
        },
        getModifiedTime: function() {
          return googFileObject.modifiedDate;
        },
        getUniqueId: function() {
          return googFileObject.id;
        }
      };
    }

    function makeFile(googFileObject, mimeType, fileExtension) {
      let cm_doc = null;
      return {
        shared: false,
        getName: function() {
          return googFileObject.title;
        },
        getURI: function() {
          return "my-gdrive://" + googFileObject.title;
        },
        getModifiedTime: function() {
          return googFileObject.modifiedDate;
        },
        getUniqueId: function() {
          return googFileObject.id;
        },
        getExternalURL: function() {
          return googFileObject.alternateLink;
        },
        getAssignment: function() {
          return drive.properties.get({
              "fileId": googFileObject.id,
              "propertyKey": "assignment",
              "visibility": "PUBLIC"
            }).then(function(result){return result.value;});
        },
        getShares: function() {
          return drive.files.list({
            q: "trashed=false and properties has {key='" + BACKREF_KEY + "' and value='" + googFileObject.id + "' and visibility='PRIVATE'}"
          })
            .then(function(files) {
              if(!files.items) { return []; }
              else { return files.items.map(fileBuilder); }
            });
        },
        getContents: function(cache_mode) {
          return fetch(googFileObject.downloadUrl,
            { method: "get",
              cache: cache_mode || "no-cache",
              headers: new Headers([
                  ['Authorization', 'Bearer ' + gapi.auth.getToken().access_token]
                ])
            }).then(function(response) {
              return response.text();
            });
        },
        getDoc: function() {
          let uri = "my-gdrive://" + this.getName();
          // TODO this is a race condition fml
          if (cm_doc == null) {
            return this.getContents().then(function(contents){
              cm_doc = CodeMirror.Doc(contents, "pyret");
              CPO.documents.set(uri, cm_doc);

              // Freeze the document contents up to the following border
              var border = "# DO NOT CHANGE ANYTHING ABOVE THIS LINE";
              var border_end_index = contents.indexOf(border) + border.length;
              var border_end_pos = cm_doc.posFromIndex(border_end_index);

              let marker =
                cm_doc.markText({line:0,ch:0}, {line: border_end_pos.line + 1, ch: 0},
                  { inclusiveLeft: true,
                    inclusiveRight: false,
                    addToHistory: false,
                    readOnly: true,
                    className: "import-marker" });

              marker.lines.slice(0, -1).forEach(function(line) {
                cm_doc.addLineClass(line, "wrap", "import-line-background");
              });

              return cm_doc;
            });
          } else {
            return Q(cm_doc);
          }
        },
        rename: function(newName) {
          return drive.files.update({
            fileId: googFileObject.id,
            resource: {
              'title': newName
            }
          }).then(fileBuilder);
        },
        makeShareCopy: function() {
          var newFile = shareCollection.then(function(c) {
            return Q($.ajax({
              url: "/create-shared-program",
              method: "post",
              data: {
                fileId: googFileObject.id,
                title: googFileObject.title,
                collectionId: c.id
              }
            }));
          });
          return newFile.then(fileBuilder);
        },
        save: function(contents, newRevision) {
          // NOTE(joe): newRevision: false will cause badRequest errors as of
          // April 30, 2014
          if(newRevision) {
            var params = { 'newRevision': true };
          }
          else {
            var params = {};
          }
          const boundary = '-------314159265358979323846';
          const delimiter = "\r\n--" + boundary + "\r\n";
          const close_delim = "\r\n--" + boundary + "--";
          var metadata = {
            'mimeType': mimeType,
            'fileExtension': fileExtension
          };
          var multipartRequestBody =
              delimiter +
              'Content-Type: application/json\r\n\r\n' +
              JSON.stringify(metadata) +
              delimiter +
              'Content-Type: text/plain\r\n' +
              '\r\n' +
              contents +
              close_delim;

          var request = gwrap.request({
            'path': '/upload/drive/v2/files/' + googFileObject.id,
            'method': 'PUT',
            'params': {'uploadType': 'multipart'},
            'headers': {
              'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
            },
            'body': multipartRequestBody});
          return request.then(fileBuilder);
        },
        _googObj: googFileObject
      };
    }

    // The primary purpose of this is to have some sort of fallback for
    // any situation in which the file object has somehow lost its info
    function fileBuilder(googFileObject) {
      if (fileBuilder == null ) {
        return null;
      } else if ((googFileObject.mimeType === 'text/plain' && !googFileObject.fileExtension)
          || googFileObject.fileExtension === 'arr') {
        return makeFile(googFileObject, 'text/plain', 'arr');
      } else {
        return makeFile(googFileObject, googFileObject.mimeType, googFileObject.fileExtension);
      }
    }

    let file_cache = new Map();

    var api = {
      about: function() {
        return drive.about.get({});
      },
      getCollectionLink: function() {
        return baseCollection.then(function(bc) {
          return "https://drive.google.com/drive/u/0/folders/" + bc.id;
        });
      },
      getCollectionFolderId: function() {
        return baseCollection.then(function(bc) { return bc.id; });
      },
      getFileById: function(id) {
        if (file_cache.has(id)) {
          return file_cache.get(id);
        } else {
          let req = drive.files.get({fileId: id}).then(fileBuilder);
          file_cache.set(id, req);
          return req;
        }
      },
      getFileByName: function(name) {
        return this.getAllFiles().then(function(files) {
          return files.filter(function(f) { return f.getName() === name; });
        });
      },
      getCachedFileByName: function(name) {
        return this.getCachedFiles().then(function(files) {
          return files.filter(function(f) { return f.getName() === name; });
        });
      },
      getSharedFileById: function(id) {
        var fromDrive = drive.files.get({fileId: id}, true).then(function(googFileObject) {
          return makeSharedFile(googFileObject, true);
        });
        fromDrive.catch(function(e){
          console.error("BAH", e);
        });
        var fromServer = fromDrive.fail(function() {
          return Q($.get("/shared-file", {
            sharedProgramId: id
          })).then(function(googlishFileObject) {
            return makeSharedFile(googlishFileObject, false);
          });
        });
        var result = Q.any([fromDrive, fromServer]);
        result.then(function(r) {
          console.log("Got result for shared file: ", r);
        }, function(r) {
          console.log("Got failure: ", r);
        });
        return result;
      },
      getGrainFilesByTemplate: function(id, type) {
        function ls(q) {
          var ret = Q.defer();
          var retrievePageOfFiles = function(request, result) {
            request.execute(function(resp) {
              result = result.concat(resp.items);
              var nextPageToken = resp.nextPageToken;
              if (nextPageToken) {
                request = gapi.client.drive.files.list({
                  'q': q,
                  'pageToken': nextPageToken
                });
                retrievePageOfFiles(request, result);
              } else {
                ret.resolve(result);
              }
            });
          }
          var initialRequest = gapi.client.drive.files.list({'q': q});
          retrievePageOfFiles(initialRequest, []);
          return ret.promise;
        }

        return ls("'"+ id + "' in parents and title = '" + type + "'")
          .then(function(results) {
            return ls("'"+ results[0].id + "' in parents")
          })
          .then(function(chaff) {
            return chaff.reduce((promiseChain, file) => {
                return promiseChain.then(chainResults =>
                    drive.files.get({"fileId": file.id}).then(file =>
                        [ ...chainResults, makeSharedFile(file,true) ]
                    )
                );
            }, Promise.resolve([]))
          });
      },
      getTemplateFileById: function(id) {
        function ls(q) {
          var ret = Q.defer();
          var retrievePageOfFiles = function(request, result) {
            request.execute(function(resp) {
              result = result.concat(resp.items);
              var nextPageToken = resp.nextPageToken;
              if (nextPageToken) {
                request = gapi.client.drive.files.list({
                  'q': q,
                  'pageToken': nextPageToken
                });
                retrievePageOfFiles(request, result);
              } else {
                ret.resolve(result);
              }
            });
          }
          var initialRequest = gapi.client.drive.files.list({'q': q});
          retrievePageOfFiles(initialRequest, []);
          return ret.promise;
        }

        function copy_template_to_drive(bc, template) {
          return drive.files.copy({
            "fileId": template.id,
            "resource": {
              "parents": [{"id": bc.id}]
            }})
            .then(function(file) {
              return drive.properties.insert({
                  "fileId": file.id,
                  "resource": {
                    "key": "assignment",
                    "value": id,
                    "visibility": "PUBLIC"
                  }
                }).then(function(_) {
                  return drive.properties.insert({
                      "fileId": file.id,
                      "resource": {
                        "key": "examplar",
                        "value": "yes",
                        "visibility": "PUBLIC"
                      }});
                }).then(function(_) {
                  return drive.permissions.insert({
                        "fileId": file.id,
                        "emailMessage": "TEST MESSAGE",
                        "sendNotificationEmails": "true",
                        "resource": {
                          "role": "reader",
                          "type": "user",
                          "value": "pyret.examplar@gmail.com"
                        }
                    });
              }).then(function(_) {
                return file;
              });
            });
        }

        var sweepFromDrive =
          baseCollection.then(function(bc){
            return drive.files.get({"fileId": id}).then(function(template) {
              return ls("not trashed and '" + bc.id + "' in parents and properties has { key='assignment' and value='" + id + "' and visibility='PUBLIC' }")
                .then(function(results) {
                  let maybe_code = results.find(result => result.title.includes('code'));
                  let maybe_tests = results.find(result => result.title.includes('tests'));
                  let maybe_common = results.find(result => result.title.includes('common'));
                  return ls("not trashed and '"+ id + "' in parents and title contains 'arr'").then(function(results) {
                    let maybe_dummy_impl = results.find(result => result.title.includes('dummy'));
                    let maybe_code_template = results.find(result => result.title.includes('code'));
                    let maybe_tests_template = results.find(result => result.title.includes('tests'));
                    let maybe_common_template = results.find(result => result.title.includes('common'));

                    let dummy_impl =
                      drive.files.get({"fileId": maybe_dummy_impl.id})
                        .then(file => makeSharedFile(file,true));

                    let code =
                      (maybe_code != null
                        ? drive.files.get({"fileId": maybe_code.id}).then(fileBuilder)
                        : function(){return (maybe_code_template != null
                            ? copy_template_to_drive(bc, maybe_code_template).then(fileBuilder)
                            : Q(null).then(fileBuilder));});

                    let tests =
                      (maybe_tests != null
                        ? drive.files.get({"fileId": maybe_tests.id})
                        : (maybe_tests_template != null
                            ? copy_template_to_drive(bc, maybe_tests_template)
                            : Q(null))).then(fileBuilder);

                    let common =
                      (maybe_common != null
                        ? drive.files.get({"fileId": maybe_common.id})
                        : (maybe_common_template != null
                            ? copy_template_to_drive(bc, maybe_common_template)
                            : Q(null))).then(fileBuilder);

                    return Q.all([code, tests, common, dummy_impl]).then(function([code, tests, common, dummy_impl]) {
                      return {assignment_name: template.title, assignment_id: id, code: code, tests: tests, common: common, dummy_impl: dummy_impl};
                    });
                  });
                });
              });
            });
        return sweepFromDrive;
      },
      getFiles: function(c) {
        return c.then(function(bc) {
          return drive.files.list({ q: "trashed=false and '" + bc.id + "' in parents" })
            .then(function(filesResult) {
              if(!filesResult.items) { return []; }
              return filesResult.items.map(fileBuilder);
            });
        });
      },
      getCachedFiles: function() {
        return this.getFiles(cacheCollection);
      },
      getAllFiles: function() {
        return this.getFiles(baseCollection);
      },
      createFile: function(name, opts) {
        opts = opts || {};
        var mimeType = opts.mimeType || 'text/plain';
        var fileExtension = opts.fileExtension || 'arr';
        var collectionToSaveIn = opts.saveInCache ? cacheCollection : baseCollection;
        return collectionToSaveIn.then(function(bc) {
          var reqOpts = {
            'path': '/drive/v2/files',
            'method': 'POST',
            'params': opts.params || {},
            'body': {
              'parents': [{id: bc.id}],
              'mimeType': mimeType,
              'title': name
            }
          };
          // Allow the file extension to be omitted
          // (Google can sometime infer from the mime type)
          if (opts.fileExtension !== false) {
            reqOpts.body.fileExtension = fileExtension;
          }
          var request = gwrap.request(reqOpts);
          return request.then(fileBuilder);
        });
      },
      checkLogin: function() {
        return collection.then(function() { return true; });
      }
    };

    var shareCollection = findOrCreateDirectory(collectionName + ".shared");
    var cacheCollection = findOrCreateCacheDirectory(collectionName + ".compiled");

    return {
      api: api,
      collection: baseCollection,
      cacheCollection: cacheCollection,
      shareCollection: shareCollection,
      reinitialize: function() {
        return Q.fcall(function() { return initialize(drive); });
      }
    };
  }

  function findOrCreateDirectory(name) {
    var q = "('me' in owners) and trashed=false and title='" + name + "' and "+
        "mimeType='" + FOLDER_MIME + "'";
    var filesReq = drive.files.list({
      q: q
    });
    var collection = filesReq.then(function(files) {
      if(files.items && files.items.length > 0) {
        return files.items[0];
      }
      else {
        var dir = drive.files.insert({
          resource: {
            mimeType: FOLDER_MIME,
            title: name
          }
        });
        return dir;
      }
    });
    return collection;
  }

  function findOrCreateCacheDirectory() {
    return findOrCreateDirectory(collectionName + ".compiled");
  }

  function initialize(wrappedDrive) {
    drive = wrappedDrive;
    var baseCollection = findOrCreateDirectory(collectionName);
    return createAPI(baseCollection);
  }

  var ret = Q.defer();
  gwrap.load({name: 'drive',
              version: 'v2',
              reauth: {
                immediate: immediate
              },
              callback: function(drive) {
                ret.resolve(initialize(drive));
              }});
  return ret.promise;
}
