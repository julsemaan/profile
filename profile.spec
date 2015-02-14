#
# Example spec file for cdplayer app...
#
Summary: Julien Semaan's profile
Name: jsemaan-profile
Version: 0.1
Release: 1
License: MIT
Group: Utils
Source: profile.tgz 
#URL: http://www.gnomovision.com/cdplayer/cdplayer.html
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

#%build
#make

%install
mkdir -p $RPM_BUILD_ROOT/usr/local/etc
cp profile/.tmux.conf $RPM_BUILD_ROOT/usr/local/etc/.tmux.conf
cp profile/.vimrc $RPM_BUILD_ROOT/usr/local/etc/.vimrc
cp profile/.bashrc_append $RPM_BUILD_ROOT/usr/local/etc/.bashrc_append 

%post
if ! grep 'source /usr/local/etc/.vimrc' /etc/vimrc > /dev/null 2>&1 ; then
    echo "Installing the sourcing of vimrc in vimrc"
    echo 'source /usr/local/etc/.vimrc' >> /etc/vimrc
    echo "" >> /etc/vimrc
fi

if ! grep 'source /usr/local/etc/.bashrc_append' /etc/profile > /dev/null 2>&1 ; then
    echo "Installing the sourcing of bashrc_append in /etc/profile"
    echo 'source /usr/local/etc/.bashrc_append' >> /etc/profile
    echo "" >> /etc/profile
fi


%files
/usr/local/etc

