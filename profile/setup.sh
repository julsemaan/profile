#!/bin/bash

function installfile {
    filename=$1
    url=$2
    echo "---------------------------------"
    echo "++ Installing $filename"
    echo "---------------------------------"
    $CURL -L $url > $filename 2>/dev/null
    echo "Done with $filename"
    echo ""
}

CURL=/usr/bin/curl

installfile "$HOME/.vimrc" "https://dl.dropboxusercontent.com/u/20280504/profile-files/vimrc"

installfile "$HOME/.tmux.conf" "https://dl.dropboxusercontent.com/u/20280504/profile-files/tmux.conf"

installfile "$HOME/.bashrc_append" "https://dl.dropboxusercontent.com/u/20280504/profile-files/bashrc_append"

if ! grep 'source ~/.bashrc_append' ~/.bashrc > /dev/null 2>&1 ; then
    echo "Installing the sourcing of bashrc_append in bashrc"
    echo 'source ~/.bashrc_append' >> ~/.bashrc
    echo "" >> ~/.bashrc
fi


echo "+++++++++"
echo "+Done...+"
echo "+++++++++"
