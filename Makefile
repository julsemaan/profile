clean:
	rm -fr build

build: 
	mkdir build
	cp -fr profile/ build/profile/
	cp -fr Makefile build/profile/Makefile
	cd build/ && tar -cvzf profile.tgz profile/

install:
	mkdir -p $(prefix)/etc
	mkdir -p $(prefix)/bin
	cp profile/.tmux.conf $(prefix)/etc/.tmux.conf
	cp profile/.vimrc $(prefix)/etc/.vimrc
	cp profile/.bashrc_append $(prefix)/etc/.bashrc_append 
	cp profile/user_install $(prefix)/bin/jprofile_install
	chmod +x $(prefix)/bin/jprofile_install

install-profile:
	$(prefix)/bin/jprofile_install

