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

# Verified active Greenhouse boards (200 from boards-api.greenhouse.io)
GREENHOUSE_SLUGS = [
    # Environmental NGOs / think tanks
    "wri",              # World Resources Institute
    "nrdc",             # Natural Resources Defense Council
    "edf",              # Environmental Defense Fund
    "rmi",              # Rocky Mountain Institute
    "ceres",            # Ceres (sustainable investing)
    "earthjustice",     # Environmental law nonprofit
    "nature",           # The Nature Conservancy
    "wcs",              # Wildlife Conservation Society
    "awf",              # African Wildlife Foundation
    # Climate tech / energy
    "watershed",        # Climate software / carbon accounting
    "climateai",        # Climate AI analytics
    "sunnova",          # Solar + battery
    "arcadiapower",     # Clean energy data
    "inari",            # Agricultural biotech / food systems
    # Research / consulting
    "rti",              # RTI International (research/consulting)
    "icf",              # ICF (environmental consulting)
    "tetratech",        # Tetra Tech (engineering/environment)
    # Data / geospatial
    "descartes",        # Descartes Labs (geospatial AI)
    "planet",           # Planet Labs (satellite imagery)
    # Energy / resources
    "enviva",           # Biomass/renewable energy
    "nrg",              # NRG Energy
    "nextracker",       # Solar tracking systems
]

# Verified active Lever boards
LEVER_SLUGS = [
    "erg",              # Environmental Resources Group (consulting)
    "arcadia",          # Clean energy retail / data
    "terraformation",   # Reforestation startup
    "pachama",          # Forest carbon monitoring
    "watershed",        # Climate accounting (also on GH, deduplicated by source_id)
    "energyvault",      # Grid-scale energy storage
    "antora",           # Thermal energy storage
]

# Ashby slugs — included but silently skipped if auth is required
# (Ashby's public API is not truly public; boards are authenticated per-company)
ASHBY_SLUGS: list[str] = []
