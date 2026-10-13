# FAQ

**Do I need a NASA API key?**
No. Earlier versions used the NeoWs API, which needs one. Version 3 uses JPL's SSD APIs, which are open.

**Why are the asteroid dots all the same size?**
At true scale, a 1 km asteroid seen from 1 AU is about a billionth of the screen. The dots are markers drawn at a fixed size on screen, slightly larger for bigger objects. Zoom close to Earth and the planets and the Moon appear at true size.

**Is the impact probability real?**
The Sentry numbers are. They come straight from JPL. The Monte Carlo is our own estimate from a finite sample, and its 95 % interval tells you how much to trust it. See [impact risk](risk.md).

**Why does CosmoRisk disagree with JPL about a pass in 2050?**
After a deep close approach, small differences grow quickly. CosmoRisk also leaves out the Yarkovsky effect and uses an analytic ephemeris. Near-term passes agree to a few hundred km; see [physics](physics.md).

**It's slow on my laptop.**
Set Graphics to *Low* in Settings, or load fewer objects. Auto mode should step down by itself if the frame rate stays under 45 fps. Physics runs on all CPU cores and takes about 1–2 ms per step for 1,000 objects.

**Where are my scenarios stored?**
In the app data directory; see [data sources](data-sources.md). Use Export to move one to another machine.

**Can I use this for research?**
For teaching, outreach and quick what-if studies, yes; please cite it ([CITATION.cff](../CITATION.cff)). For anything that matters, use JPL Horizons, Sentry and NEOCC.

**Windows says the installer is unrecognised.**
The builds are not code-signed yet. Choose "More info → Run anyway", or build from source.
