- A command like gch that either has completion of branch names or opens something that allows to pick the branch due to the lack of autocompletion on gch
- When using gpoh, it doesn't work consistently on branches other than master, perhaps due to some missing .git/config for the branch. I'd like that config to not be necessary for gpoh to work.
  - Example:
  ```
From example.com:workspace/repo
* branch            HEAD       -> FETCH_HEAD
hint: You have divergent branches and need to specify how to reconcile them.
hint: You can do so by running one of the following commands sometime before
hint: your next pull:
hint:
hint:   git config pull.rebase false  # merge
hint:   git config pull.rebase true   # rebase
hint:   git config pull.ff only       # fast-forward only
hint:
hint: You can replace "git config" with "git config --global" to set a default
hint: preference for all repositories. You can also pass --rebase, --no-rebase,
hint: or --ff-only on the command line to override the configured default per
hint: invocation.
fatal: Need to specify how to reconcile divergent branches.
  ```
