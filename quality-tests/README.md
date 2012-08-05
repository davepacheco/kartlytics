Existing video files are extremely large.  For the captures on my laptop, I
have:

FILE                          BITRATE   LEN(s) ESTMB    MB
2012-06-11-01.mov           3647 Kbps    1347s  599M  599M
2012-06-11-02.mov           3699 Kbps    2393s 1081M 1081M
2012-06-19-00.mov          18978 Kbps     153s  354M  354M
2012-06-19-02.mov          15318 Kbps     142s  266M  266M
2012-06-19-03.mov          16502 Kbps     145s  294M  294M
2012-06-19-04.mov          19229 Kbps     142s  335M  335M
2012-06-19-05.mov          18110 Kbps     173s  383M  383M
2012-06-19-06.mov           4348 Kbps     137s   73M   73M
2012-06-19-07.mov           6236 Kbps     165s  125M  125M
2012-06-19-08.mov          16724 Kbps     173s  354M  354M
2012-06-19-09.mov          24889 Kbps     173s  525M  525M
2012-06-19-10.mov          23367 Kbps     175s  501M  501M
2012-06-28-00.mov          18882 Kbps    1099s 2534M 2534M
2012-06-29-00.mov          19099 Kbps     145s  338M  338M
2012-06-29-01.mov          22036 Kbps     177s  477M  477M
2012-06-29-02.mov          20180 Kbps     204s  504M  504M
2012-06-29-03.mov          20060 Kbps     174s  427M  427M
2012-06-29-04.mov          14127 Kbps     169s  291M  291M
2012-06-29-05.mov          23999 Kbps     188s  552M  552M
2012-06-29-06.mov          13605 Kbps     204s  339M  339M
2012-06-29-07.mov          21447 Kbps     286s  749M  749M

According to [Wikipedia](http://en.wikipedia.org/wiki/Bit_rate), SDTV-quality
video can be compressed to about 3.5Mbps without much loss in perceived quality.
On the above videos, that alone would save us a factor of 4.5 in disk space.  I
played around with this on a few videos, with these results:

FILE                          BITRATE   LEN(s) ESTMB    MB
2012-06-19-07-small.mov     3573 Kbps     165s   72M   72M
2012-06-19-00-small.mov     3693 Kbps     153s   69M   69M
2012-06-19-00-small2.mov    3719 Kbps     153s   69M   69M

These were transcoded using:

# ffmpeg -i 2012-06-19-07.mov -b:v 3584k       2012-06-19-07-small.mov
# ffmpeg -i 2012-06-19-00.mov -b:v 3584k       2012-06-19-00-small.mov
# ffmpeg -i 2012-06-19-00.mov -b:v 3584k -g 15 2012-06-19-00-small2.mov

The "-g 15" option tells ffmpeg to add a keyframe at most every 15 frames.
Without that option, significant artifacts were introduced at the start of the
race that disappeared after a few seconds.  The output file was not
significantly larger with "-g 15" (only 0.07% larger), and with that option in
place, though the artifacts still appear for a second, the overall video quality
seems about the same as at the full bitrate.

I ran the result through kartvid and, somewhat surprisingly, the time required
to process all versions of 2012-06-19-00 was about the same, about 43s.  The
output was only slightly different: the sequence of events was exactly the same,
but the timestamps were off by up to 3 seconds (but most only up to 1s).  About
2/3 of the timestamps were the same, up to the seconds digit.

To broaden the test, I tried this out on all the videos I have on my laptop,
which include most videos from June, 2012.  Here are the results:

2012-06-19-02.txt: Frappe: misses a pair of passes within .4s of each other
2012-06-19-04.txt: Choco: takes 5 extra seconds to notice Wario finishing
2012-06-19-05.txt: empty, missed "done" frame entirely
2012-06-19-10.txt: Takes 6 extra seconds to notice Yoshi passing Wario
    and extra 32s to notice "Toad passes Yoshi" (!)
2012-06-28-00.txt: at 8:22, misses the fact that Peach finished as a distinct
    event
2012-06-28-00.txt: missing some churn due to an extra 6s to detect pass
2012-06-29-05.txt: 13 second delay to notice "Peach passes Toad"
2012-06-11-02.txt:
   - 22m: new version detects two passes 13 seconds earlier
   - missed pass around 23:19, and missed finish (sort of the same problem)
   - missed pass as the race ended at 28:14

The majority of races were fine or had only 1s changes in timing.  I think the
space savings is worth it, and then we can go back and figure out why some of
the identifications failed.  We may need to tune some thresholds up.
