"""
Curated source lists — edit here to add/remove orgs without touching pipeline code.
USGS_SEARCHES:  keyword+org combos for USAJobs federal searches
GREENHOUSE_SLUGS: company slugs confirmed active on Greenhouse Jobs API
LEVER_SLUGS:      company slugs confirmed active on Lever Postings API
"""

USAJOBS_SEARCHES = [
    # Environmental science / ecology
    {"keyword": "environmental scientist",   "pages": 2},
    {"keyword": "environmental engineer",    "pages": 2},
    {"keyword": "natural resources",         "pages": 2},
    {"keyword": "ecologist",                 "pages": 1},
    {"keyword": "soil scientist",            "pages": 1},
    # Water / hydrology — USGS sweet spot
    {"keyword": "water resources",           "pages": 2},
    {"keyword": "water quality",             "pages": 2},
    {"keyword": "groundwater",               "pages": 1},
    {"keyword": "streamflow",                "pages": 1},
    # Geospatial / remote sensing
    {"keyword": "geospatial",                "pages": 2},
    {"keyword": "remote sensing",            "pages": 1},
    {"keyword": "GIS analyst",               "pages": 1},
    # Data science / analysis
    {"keyword": "data scientist",            "pages": 2},
    {"keyword": "data analyst",              "organization": "EP", "pages": 1},  # EPA
    {"keyword": "data analyst",              "organization": "IN", "pages": 1},  # Interior/USGS
    # Climate / energy
    {"keyword": "climate",                   "pages": 1},
    {"keyword": "atmospheric scientist",     "pages": 1},
]

GREENHOUSE_SLUGS = [
    # Environmental nonprofits & policy
    "wri",             # World Resources Institute
    "watershed",       # Climate software / carbon accounting
    "rti",             # RTI International (research/consulting)
    "enviva",          # Biomass/renewable energy
]

LEVER_SLUGS = [
    # Environmental consulting & clean energy
    "erg",             # Environmental Resources Group (consulting)
    "arcadia",         # Clean energy retail / data
]
