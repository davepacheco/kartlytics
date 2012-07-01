#!/bin/bash

#
# collapse.sh: collapse kart captures
#
for dir in $*; do
	for file in $dir/Recording_00??.mov; do
		newfile=$(basename $file)
		newfile=${newfile: -6}
		echo mv $file $dir-$newfile
		mv $file $dir-$newfile
	done
done
