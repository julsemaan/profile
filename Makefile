clean:
	rm -fr build

build: 
	mkdir build
	cp -fr profile/ build/profile/
	cp -fr Makefile build/profile/Makefile
	cd build/ && tar -cvzf profile.tgz profile/

install:
	mkdir -p $(install-dir)/etc
	mkdir -p $(install-dir)/bin
	cp profile/.tmux.conf $(install-dir)/etc/.tmux.conf
	cp profile/.vimrc $(install-dir)/etc/.vimrc
	cp profile/.bashrc_append $(install-dir)/etc/.bashrc_append 
	cp profile/user_install $(install-dir)/bin/jprofile_install
	chmod +x $(install-dir)/bin/jprofile_install

install-profile:
	/usr/local/bin/jprofile_install

