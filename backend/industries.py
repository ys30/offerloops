"""Consolidated industry categories mapping raw tags to canonical sectors."""

INDUSTRY_MAP: dict[str, list[str]] = {
    "Energy": [
        "Energy", "Department of Energy", "Utility Systems Repairing-Operating",
        "Utility Systems Operating", "Boiler Plant Operating", "Petroleum Engineering",
        "Nuclear security",
    ],
    "Climate & Environment": [
        "Climate Adaptation", "Carbon Removal Tech", "Coastal & Ocean Sinks",
        "Environmental Engineering", "Environmental Protection Specialist",
        "Climate change", "EHS", "Ecology", "Hydrology", "Soil Conservation",
        "Soil Science", "Fish Biology", "Wildlife Biology", "Forestry",
        "Oceanography", "Meteorology", "General Natural Resources Management And Biological Sciences",
        "Geophysics", "Geology", "Industrial Hygiene",
    ],
    "Research & Science": [
        "Research", "Research & Education", "General Physical Science", "Physics",
        "Chemistry", "Toxicology", "Mathematics", "Statistics",
        "General Mathematics And Statistics", "Mathematical Statistics",
        "Astronomy And Space Science", "Data Science Series", "Operations Research",
        "Biological Science Technician", "Physical Science Student Trainee",
        "Geodesy", "Cartography", "Geography", "Land Surveying",
        "Engineering and Science", "Meteorological Technician",
    ],
    "Policy & Advocacy": [
        "Policy", "Advocacy or Policy", "AI safety & policy", "Other policy-focused",
        "Macrostrategy", "Outreach", "Congressional staffer",
        "Building effective altruism", "Global health & development",
        "Biosecurity & pandemic preparedness",
    ],
    "Government & Defense": [
        "Department of the Air Force", "Department of Defense", "Department of the Navy",
        "Department of the Army", "Department of Agriculture",
        "Department of the Interior", "Department of Veterans Affairs",
        "Department of Health and Human Services", "Department of Justice",
        "Department of Commerce", "Department of Transportation",
        "Department of Homeland Security", "Department of Labor",
        "Department of Housing and Urban Development",
        "Other Agencies and Independent Organizations", "Legislative Branch",
        "Executive Office of the President", "General Services Administration",
        "National Aeronautics and Space Administration",
        "Other Agencies and Independent Organizations",
        "Miscellaneous Administration And Program", "Management And Program Analysis",
    ],
    "Technology & AI": [
        "Software engineering", "Information security", "Information Technology Management",
        "Computer Engineering", "Digital Solutions and Information Technology",
        "Information Technology", "System Administration", "MIS",
        "Computer Science", "Intelligence",
    ],
    "Food & Agriculture": [
        "Food, Agriculture, & Land Use", "Agricultural Engineering",
        "Food Service Working",
    ],
    "Transportation": [
        "Transportation", "Air Traffic Control", "Aviation Safety",
        "Aircraft Mechanic", "Aircraft Electrician",
        "Aircraft Pneudraulic Systems Mechanic", "Miscellaneous Aircraft Overhaul",
        "Aircraft Engine Mechanic", "Aircraft Ordnance Systems Mechanic",
        "Department of Transportation",
    ],
    "Finance & Capital": [
        "Capital", "Finance", "Funding", "Financial Management",
        "Financial Administration And Program", "Accounting", "Grants Management",
        "Contracting", "Contracts", "Contracts Administration",
        "Budget Analysis", "Economist",
    ],
    "Engineering & Manufacturing": [
        "Engineering", "General Engineering", "Civil Engineering",
        "Mechanical Engineering", "Electrical Engineering", "Electronics Engineering",
        "Materials & Manufacturing", "Engineering Technical",
        "Engineering Equipment Operating", "Architecture",
        "Landscape Architecture", "Community Planning",
    ],
    "Health & Medicine": [
        "Global health & development", "Biosecurity & pandemic preparedness",
        "General Health Science", "Medical Officer", "Nurse",
        "Occupational Therapist", "Dental Officer", "Clinical Laboratory Science",
    ],
    "Buildings": [
        "Buildings", "Architecture", "Community Planning",
        "Landscape Architecture", "Facility Operations Services",
    ],
    "Consulting & Strategy": [
        "Consulting Services", "Strategy", "Management", "Operations",
        "General Business And Industry", "Quality Assurance",
        "Safety and Occupational Health Management",
    ],
    "Education & Fellowships": [
        "Research & Education", "Fellowship", "Career development",
        "Education And Vocational Training", "General Education And Training",
        "Training, Learning, and Development",
    ],
}

# Reverse map: raw tag -> canonical industry
TAG_TO_INDUSTRY: dict[str, str] = {}
for industry, tags in INDUSTRY_MAP.items():
    for tag in tags:
        TAG_TO_INDUSTRY[tag] = industry
