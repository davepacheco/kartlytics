# Manta-based kartlytics, take two

Goals:

* client should be able to fetch exactly what it needs (aggregated stats) easily
* should provide links to full videos and race videos

Workflow:

* upload video
* save human metadata on per-video basis (so that we can re-chunk races)
* chunk video into races:
  * produce race transcript:
    * identify races
    * identify characters
    * identify tracks
  * convert transcript to stats
  * save web-quality video
* rerun chunking on a per-video or global basis
* re-aggregate chunked stats

Want to save all results *separate* from videos so I can generate a parallel set
of results for testing.

Individual jobs (phases):

* enumerate raw videos not chunked since time X (or never chunked)
* enumerate chunked videos with no user metadata
* given video, produce start times, race transcript (races, characters, tracks)
* given start times, save screenshots
* given start times, save web-quality videos
* aggregate race transcripts into a single file for the client

Optimization for version 2: 
* Run separate "find starts of races" phase to chunk up raw videos for parallel
  processing of the individual races

Directory structure:

videos/		Raw videos and metadata
    foo.mov	Raw video file
    foo.json	Raw user metadata
generated/
    summary.json	Giant blob returned to client
    foo/
    	pngs/		Screenshots of key moments
	webm/		Web-quality videos of races
	races.json	Transcript of races
	starts.json	Start times of contained races
