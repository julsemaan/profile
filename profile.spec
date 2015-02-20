#
# Spec file for Julien Semaan's profile
#
Summary: Julien Semaan's profile
Name: jsemaan-profile
Version: 0.1
Release: 1
License: MIT
Group: Utils
Source: profile.tgz 
Distribution: CentOS
Vendor: Julien Semaan
Packager: Julien Semaan <julien@semaan.ca>
BuildRoot: %{_tmppath}/%{name}-%{version}-%{release}

Requires: vim
Requires: bash
Requires: tmux

%description
Julien Semaan's profile

%prep
rm -rf $RPM_BUILD_DIR/profile
zcat $RPM_SOURCE_DIR/profile.tgz | tar -xvf -
mv profile/Makefile .

%install
make install prefix=$RPM_BUILD_ROOT/usr/local

%post
/usr/local/bin/jprofile_install

%files
/usr/local/etc
/usr/local/bin/jprofile_install


