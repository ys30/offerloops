"""
Curated source lists — edit here to add/remove orgs without touching pipeline code.
All slugs have been verified as active on their respective ATS platforms.
"""

USAJOBS_SEARCHES = [
    # Environmental science / ecology
    {"keyword": "environmental scientist",   "pages": 2},
    {"keyword": "environmental engineer",    "pages": 2},
    {"keyword": "natural resources",         "pages": 2},
    {"keyword": "ecologist",                 "pages": 1},
    {"keyword": "soil scientist",            "pages": 1},
    {"keyword": "conservation biologist",    "pages": 1},
    # Water / hydrology
    {"keyword": "water resources",           "pages": 2},
    {"keyword": "water quality",             "pages": 2},
    {"keyword": "groundwater",               "pages": 1},
    {"keyword": "hydrologist",               "pages": 1},
    {"keyword": "streamflow",                "pages": 1},
    # Geospatial / remote sensing
    {"keyword": "geospatial",                "pages": 2},
    {"keyword": "remote sensing",            "pages": 1},
    {"keyword": "GIS analyst",               "pages": 1},
    {"keyword": "geographer",                "pages": 1},
    # Data science / analysis
    {"keyword": "data scientist",            "pages": 2},
    {"keyword": "data analyst",    "organization": "EP", "pages": 1},  # EPA
    {"keyword": "data analyst",    "organization": "IN", "pages": 1},  # Interior/USGS
    {"keyword": "statistician",              "pages": 1},
    # Climate / energy / atmosphere
    {"keyword": "climate",                   "pages": 2},
    {"keyword": "atmospheric scientist",     "pages": 1},
    {"keyword": "meteorologist",             "pages": 1},
    {"keyword": "oceanographer",             "pages": 1},
    {"keyword": "air quality",               "pages": 1},
    # HPC / AI / computational
    {"keyword": "machine learning",          "pages": 1},
    {"keyword": "computational scientist",   "pages": 1},
    {"keyword": "research scientist",        "pages": 1},
    # Agency-specific
    {"keyword": "scientist",    "organization": "EP", "pages": 2},   # EPA
    {"keyword": "scientist",    "organization": "GS", "pages": 2},   # USGS
    {"keyword": "scientist",    "organization": "NN", "pages": 1},   # NOAA
    {"keyword": "engineer",     "organization": "IN", "pages": 1},   # Interior
    {"keyword": "analyst",      "organization": "AG", "pages": 1},   # USDA/Forest Service
]

# Verified active Greenhouse boards (boards-api.greenhouse.io — re-verified 2026-09-19)
GREENHOUSE_SLUGS = [
    # Environmental NGOs / think tanks
    "wri",              # World Resources Institute
    # Climate tech / energy
    "watershed",        # Climate software / carbon accounting
    "sunnova",          # Solar + battery
    # Carbon removal / CDR
    "carbondirect",     # Carbon Direct (science advisory)
    "captura",          # Captura (ocean-based CO2 removal)
    # Energy storage
    "solidpower",       # Solid Power (solid-state batteries)
    # Research / consulting
    "rti",              # RTI International (research/consulting)
    # Data / geospatial
    "planetlabs",       # Planet Labs (satellite imagery)
    # Energy / resources
    "enviva",           # Biomass/renewable energy
    # Geospatial / earth observation / data
    "esri",             # Esri (GIS software) — 441 US jobs
    "spire",            # Spire Global (satellite data) — 39 jobs
    "hawkeye360",       # HawkEye 360 (RF satellite analytics) — 17 jobs
    "blacksky",         # BlackSky Technology (satellite imagery analytics) — 23 jobs
    "albedo",           # Albedo (commercial satellite imagery) — 10 jobs
    # Data / AI platforms (many env/science roles)
    "databricks",       # Databricks (data + AI) — 878 jobs
    "muonspace",        # Muon Space (earth observation) — 121 jobs
    # Advanced energy
    "kairospower",      # Kairos Power (nuclear energy) — 25 jobs (Albuquerque NM location)
    # Weather / climate intelligence
    "tomorrow",         # Tomorrow.io (weather intelligence & climate services) — 20 jobs
    # Scientific instruments for env research
    "licor",            # LI-COR Biosciences (field research instruments) — 6 jobs
]

# Verified active Lever boards (api.lever.co — re-verified 2026-09-19)
LEVER_SLUGS = [
    "erg",              # Environmental Resources Group (consulting)
    "arcadia",          # Clean energy retail / data
    "pachama",          # Forest carbon monitoring
    "charmindustrial",  # Charm Industrial (carbon removal via bio-oil)
    "deepsky",          # Deep Sky (carbon capture project developer)
    "palantir",         # Palantir (data analytics) — 313 jobs
    "jupiterintel",     # Jupiter Intelligence (climate risk analytics) — 2 jobs
    "arable",           # Arable (agricultural sensing + data science) — 5 jobs
]

# Ashby slugs — included but silently skipped if auth is required
# (Ashby's public API is not truly public; boards are authenticated per-company)
ASHBY_SLUGS: list[str] = []

# SmartRecruiters company slugs — verified 2026-09-19 (US-only filter applied at fetch time)
SMARTRECRUITERS_SLUGS = [
    "sgs",          # SGS (env monitoring, inspection, lab testing) — 347 US jobs
    "eurofins",     # Eurofins (env/water/air laboratory testing) — 540 US jobs
    "cardno",       # Cardno (env/water consulting) — 3 US jobs
]
