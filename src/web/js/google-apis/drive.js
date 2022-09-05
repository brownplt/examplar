class Batch {
  constructor() {
    this.empty = true;
    this.batch = gapi.client.newBatch();
  }

  add(name, req) {
    this.empty = false;
    this.batch.add(req, {'id': name});
  }

  get(name, path, params) {
    console.trace("DEPRECATED");
    this.empty = false;
    this.batch.add(gapi.client.request({
      path: path,
      params: params,
    }), {'id': name});
  }

  post(name, path, params) {
    console.trace("DEPRECATED");
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
          console.error({request: name, response: response});
          throw {request: name, response: response};
        } else {
          results[name] = response.result;
        }
      }
      return results;
    })
  }
}

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
    var shareCollection = findOrCreateDirectory(collectionName + ".shared");
    var cacheCollection = findOrCreateCacheDirectory(collectionName + ".compiled");

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
      let contents = null;
      return {
        shared: false,
        edited: function() {
          return drive.properties.patch({
            "fileId": googFileObject.id,
            "propertyKey": "edited",
            "visibility": "PUBLIC",
            "resource": {
              "key": "edited",
              "value": true,
            }
          });
        },
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
          let id = this.getUniqueId();
          if (contents != null) {
            return contents;
          } else {
            let url = "https://www.googleapis.com/drive/v3/files/" + googFileObject.id + "?alt=media&source=download";
            return fetch(url,
              { method: "get",
                cache: cache_mode || "no-cache",
                headers: new Headers([
                    ['Authorization', 'Bearer ' + gapi.auth.getToken().access_token]
                  ])
              }).then(function(response) {
                contents = response.text();
                return contents;
              });
          }
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

          var request = gwrap.request({
            'path': '/upload/drive/v2/files/' + googFileObject.id,
            'method': 'PUT',
            'params': {'uploadType': 'media'},
            'headers': {
              'Content-Type': 'text/plain',
              'Content-Length': new Blob([contents]).size,
            },
            'body': contents});
          return request.then(fileBuilder);
        },
        _googObj: googFileObject
      };
    }

    // The primary purpose of this is to have some sort of fallback for
    // any situation in which the file object has somehow lost its info
    function fileBuilder(googFileObject) {
      if (googFileObject == null ) {
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
      getCacheCollectionFolderId: function() {
        return cacheCollection.then(function(cc) { return cc.id; });
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
      getTemplateFileById: function(id) {

        let user_and_template_files =
          baseCollection.then(function (bc) {
            var batch = new Batch();

            batch.add('user_files',
              gapi.client.drive.files.list({
                'q': `not trashed and "${bc.id}" in parents and properties has {key="assignment" and value="${id}" and visibility="PUBLIC"}`
              }));

            batch.add('template_files',
              gapi.client.drive.files.list({
                'q': `not trashed and "${id}" in parents`
              }));

            return batch.run().then(function (result) {
              result["bc"] = bc;
              return result;
            });
          });

        /* query wheats and chaffs */
        let user_and_wheat_and_chaff =
          user_and_template_files.then(function({bc, user_files, template_files}) {
            // if necessary, copy the template file of `name` to the user gdrive
            function maybe_copy_template(name, batch, template_files, user_files) {
              let user_file = user_files.find(file => file.title.includes(name));

              if (!user_file) {
                let template_file = template_files.find(file => file.title.includes(name));

                if (template_file) {
                  batch.add(name,
                    gapi.client.drive.files.copy({
                      fileId: template_file.id,
                      resource: {
                        "parents": [{"id": bc.id}],
                        "properties": [
                          {
                            "key": "assignment",
                            "value": id,
                            "visibility": "PUBLIC",
                          },
                          {
                            "key": "edited",
                            "value": "false",
                            "visibility": "PUBLIC",
                          }
                        ],
                      }
                    }));
                }
              }
            }

            var batch = new Batch();

            let wheat = template_files.items.find(file => file.title == "wheat");
            let chaff = template_files.items.find(file => file.title == "chaff");

            try {
              // sid: I know this isn't ideal, but I'm not too worried about an enterprising user
              // finding a 'hints' file if they look hard at the Javascript bindings.
              let hints = template_files.items.find(file => file.title == "hints.json");

              if (hints == null)
              {
                console.log('COULD NOT FETCH HINTS!');
                window.hints = {}
              }
              else
              {

              drive.files.get({fileId: hints.id, alt: 'media',})
                          .then(res =>  window.hints = res.result)
              }
            }
            catch(Exception) {
              // Again, not ideal but this is a safeguard against
              // an unstable experience.
              console.err('COULD NOT FETCH HINTS.')
              console.log('COULD NOT FETCH HINTS.')
            }

            if (wheat && chaff) {
              batch.add('wheat',
                gapi.client.drive.files.list({
                  'q': `not trashed and "${wheat.id}" in parents`
                }));
              batch.add('chaff',
                gapi.client.drive.files.list({
                  'q': `not trashed and "${chaff.id}" in parents`
                }));
            }

            maybe_copy_template('code',    batch, template_files.items, user_files.items);
            maybe_copy_template('common',  batch, template_files.items, user_files.items);
            maybe_copy_template('tests',   batch, template_files.items, user_files.items);

            let share = template_files.items.find(file => file.title == "shares.txt");

            let shares_defer = Q.defer();
            let shares_promise = shares_defer.promise;

            if (share) {
              gapi.client.drive.files.get({
                'fileId': share.id,
                alt: 'media',
              }).then(function(shares) {
                shares_defer.resolve(shares.body.split("\n").filter(e => e.includes("@")));
              });
            }

            return batch.run().then(function({wheat, chaff, code, common, tests}) {
              if (!code) { code = user_files.items.find(file => file.title.includes("code")); }
              if (!common) { common = user_files.items.find(file => file.title.includes("common")); }
              if (!tests) { tests = user_files.items.find(file => file.title.includes("tests")); }

              if (!wheat) { wheat = []; } else { wheat = wheat.items; }
              if (!chaff) { chaff = []; } else { chaff = chaff.items; }

              shares_promise.then(function(shares) {
                let batch = new Batch();
                [code, common, tests].filter(f => f).forEach(function (file, i) {
                  shares.forEach(function(email) {
                    batch.add(`permissions-${email}-${i}`,
                      gapi.client.drive.permissions.insert({
                          "fileId": file.id,
                          "sendNotificationEmails": "false",
                          "resource": {
                            "role": "reader",
                            "type": "user",
                            "value": email,
                          }
                      }));
                  });
                });

                batch.run().then(function(results) {
                  console.error("PERMISSIONS SET", results);
                }, function(error) {
                  console.error("PERMISSIONS ERROR", error);
                });
              });

              return {wheat, chaff, code, common, tests,
                dummy_impl: template_files.items.find(file => file.title.includes("dummy")),
              };
            });
          });

        return user_and_wheat_and_chaff.then(function({wheat, chaff, code, common, tests, dummy_impl}) {
          return {
            assignment_name: "assignment", // TODO: actually thread in the assignment name
            assignment_id: id,
            wheat: wheat.map(file => makeSharedFile(file, true)),
            chaff: chaff.map(file => makeSharedFile(file, true)),
            code: fileBuilder(code),
            tests: fileBuilder(tests),
            common: fileBuilder(common),
            dummy_impl: makeSharedFile(dummy_impl, true),
          };
        });
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
