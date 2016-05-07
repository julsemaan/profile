clean:
	rm -fr build

update:
	profile/update

build: 
	mkdir build
	cp -fr profile/ build/profile/
	cp -fr Makefile build/profile/Makefile
	cd build/ && tar -cvzf profile.tgz profile/

install:
	mkdir -p $(install-dir)/usr/local/etc
	mkdir -p $(install-dir)/usr/local/bin
	cp profile/.tmux.conf $(install-dir)/usr/local/etc/.tmux.conf
	cp profile/.vimrc $(install-dir)/usr/local/etc/.vimrc
	cp profile/.bashrc_append $(install-dir)/usr/local/etc/.bashrc_append 
	cp profile/user_install $(install-dir)/usr/local/bin/jprofile_install
	chmod +x $(install-dir)/usr/local/bin/jprofile_install
	cp profile/update $(install-dir)/usr/local/bin/jprofile_update
	chmod +x $(install-dir)/usr/local/bin/jprofile_update

install-profile:
	/usr/local/bin/jprofile_install

install-full: install install-profile

upload:
	python util/upload.py
