
function compileFiles(source) {
    return gapi.client.drive.files.list({
        q: `not trashed and "${source}" in parents and title contains '.arr'`
    }).then(res => {
        const files = res.result.items;
        const imports = files.map(file =>
            `import shared-gdrive("${file.title}", "${file.id}") as _`
        );
        CPO.editor.cm.setValue(imports.join('\n'));
        return files.map(file => {
            return {
                compiledName: `shared-gdrive://${file.title}:${file.id}`,
                targetName: file.title.split('.arr')[0] + '.js',
            };
        });
    });
}

function copyCompiled(wheatFiles, wheatTarget, chaffFiles, chaffTarget, mutantFiles = null, mutantTarget = null) {
    storageAPI.then(api => api.getCacheCollectionFolderId()).then(folderId => {
        function copyFiles(files, targetFolder) {
            const nameSelector = files
                .map(file => `title="${file.compiledName}"`)
                .join(' or ');

            gapi.client.drive.files.list({
                q: `not trashed and "${folderId}" in parents and (${nameSelector})`
            }).then(res => {
                console.log("FOUND", res.result.items);
                res.result.items.map(file => {
                    const targetName = files.find(f => f.compiledName == file.title).targetName;
                    console.log(targetName);
                    return gapi.client.drive.files.copy({
                        fileId: file.id,
                        resource: {
                          title: targetName,
                          parents: [{id: targetFolder}],
                        }
                    }).execute(fixCompiled);
                })
            })
            .catch(e => console.error(e));
        }

        Promise.all([wheatFiles, chaffFiles]).then(([wheatFiles, chaffFiles]) => {
            copyFiles(wheatFiles, wheatTarget);
            copyFiles(chaffFiles, chaffTarget);

            if (mutantFiles != null) {

                console.log("Copying mutants")
                copyFiles(mutantFiles, mutantTarget);
            }
        });
    })
}

function deepMap(obj, f, ctx) {
    if (Array.isArray(obj)) {
        return obj.map(function(val, key) {
            return (typeof val === 'object') ? deepMap(val, f, ctx) : f.call(ctx, val, key);
        });
    } else if (typeof obj === 'object') {
        var res = {};
        for (var key in obj) {
            var val = obj[key];
            if (typeof val === 'object') {
                res[key] = deepMap(val, f, ctx);
            } else {
                res[key] = f.call(ctx, val, key);
            }
        }
        return res;
    } else {
        return obj;
    }
}

function file_contents(file) {
  let url = "https://www.googleapis.com/drive/v3/files/" + file.id + "?alt=media&source=download";
  return fetch(url,
    { method: "get",
      cache: "no-cache",
      headers: new Headers([
          ['Authorization', 'Bearer ' + gapi.auth.getToken().access_token]
        ])
    }).then(function(response) {
      contents = response.text();
      return contents;
    });
}

function save(file, contents) {
  return gapi.client.request({
    'path': '/upload/drive/v2/files/' + file.id,
    'method': 'PUT',
    'params': {'uploadType': 'media'},
    'headers': {
      'Content-Type': 'text/plain',
      'Content-Length': new Blob([contents]).size,
    },
    'body': contents});
}

async function fixCompiled(file) {
  console.log("Fixing", file);
  let contents = eval(await file_contents(file));
  let new_contents = JSON.stringify(deepMap(contents, function(val, key) {
    if (key == 'uri-of-definition') {
      return `gdrive-js://${file.id}`;
    } else {
      return val;
    }
  }));

  await save(file, new_contents);
  console.log("Copied & Corrected", file);
}
