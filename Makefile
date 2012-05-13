out/check: src/check.c | out
	gcc -Wall -o $@ $^

out:
	mkdir $@
