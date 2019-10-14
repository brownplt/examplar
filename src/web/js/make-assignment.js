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

function copyCompiled(wheatFiles, wheatTarget, chaffFiles, chaffTarget) {
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
                    gapi.client.drive.files.copy({
                        fileId: file.id,
                        resource: {
                          title: targetName,
                          parents: [{id: targetFolder}],
                        }
                    }).then(() => console.log("COPIED"));
                })
            })
            .catch(e => console.error(e));
        }

        Promise.all([wheatFiles, chaffFiles]).then(([wheatFiles, chaffFiles]) => {
            copyFiles(wheatFiles, wheatTarget);
            copyFiles(chaffFiles, chaffTarget);
        });
    })
}