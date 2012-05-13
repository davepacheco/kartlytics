out/kartvid: src/kartvid.c | out
	gcc -Wall -o $@ $^

out:
	mkdir $@

clean:
	rm -rf out cscope.files cscope.out cscope.in.out cscope.po.out

xref:
	find src -type f > cscope.files
	cscope -bqR
