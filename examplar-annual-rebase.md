Each August, Examplar should be rebased on CPO horizon.

Create a new branch named $CURRENT_YEAR:
```
git checkout -b $(date +"%Y")
```

Squash all commits since the last rebase:
```
git reset --soft $(git log --pretty=format:"%H" --grep='implement examplar')

git commit --amend -m "implement examplar

This is a squash of the commits for the version of Examplar deployed in Fall $(date --date='1 year ago' +%Y), rebased on CPO changes made before Fall $(date +"%Y")."

git remote add cpo git@github.com:brownplt/code.pyret.org.git

git fetch cpo

git rebase cpo/horizon
```

Fix the conflicts, ensure everything works, then finally:
```
git rebase --continue
```

git checkout refs/remotes/origin/2021 --
