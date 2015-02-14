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

installfile "$HOME/.vimrc" "https://googledrive.com/host/0B-k7e2bQSB5_cGRRNUl4Qk96SWs"

installfile "$HOME/.tmux.conf" "https://googledrive.com/host/0B-k7e2bQSB5_WEFqNzR1YlVTaVk"

installfile "$HOME/.bashrc_append" "https://googledrive.com/host/0B-k7e2bQSB5_ZzRvZEdrSXJzY0U"

if ! grep 'source ~/.bashrc_append' ~/.bashrc > /dev/null 2>&1 ; then
    echo "Installing the sourcing of bashrc_append in bashrc"
    echo 'source ~/.bashrc_append' >> ~/.bashrc
    echo "" >> ~/.bashrc
fi


echo "+++++++++"
echo "+Done...+"
echo "+++++++++"