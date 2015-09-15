clean:
	rm -fr build

update:
	curl -L https://googledrive.com/host/0B-k7e2bQSB5_cGRRNUl4Qk96SWs > profile/.vimrc
	curl -L https://googledrive.com/host/0B-k7e2bQSB5_WEFqNzR1YlVTaVk > profile/.tmux.conf
	curl -L https://googledrive.com/host/0B-k7e2bQSB5_ZzRvZEdrSXJzY0U > profile/.bashrc_append

build: 
	mkdir build
	cp -fr profile/ build/profile/
	cp -fr Makefile build/profile/Makefile
	cd build/ && tar -cvzf profile.tgz profile/

install:
	mkdir -p /etc
	mkdir -p /bin
	cp profile/.tmux.conf /etc/.tmux.conf
	cp profile/.vimrc /etc/.vimrc
	cp profile/.bashrc_append /etc/.bashrc_append 
	cp profile/user_install /bin/jprofile_install
	chmod +x /bin/jprofile_install
	cp profile/update /bin/jprofile_update
	chmod +x /bin/jprofile_update

install-profile:
	/bin/jprofile_install

install-full: install install-profile

upload:
	python util/upload.py
