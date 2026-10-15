# Explore the API entities before designing the database schema.
#
# Run from the repository root:  Rscript analysis/exploration/explore_entities.R
# or open it in RStudio and run it section by section.
#
# Input: files saved during step 0 in data/raw/exploration/.
# Section 6 makes 1 small request to the API (2 hours of one bike station).

library(jsonlite)
library(dplyr)
library(ggplot2)
library(httr2)

# Find the repository root: walk up from the working directory until a folder
# contains docker-compose.yml. Works whether R starts in the root, in
# analysis/exploration/ or in another subfolder of the project.
find_root <- function(dir = getwd()) {
  while (!file.exists(file.path(dir, "docker-compose.yml"))) {
    parent <- dirname(dir)
    if (parent == dir) {
      stop("Project root not found from ", getwd(),
           ". Run setwd('<path to montpellier-mobility-forecast>') first.")
    }
    dir <- parent
  }
  dir
}

raw_dir <- file.path(find_root(), "data", "raw", "exploration")
# fromJSON() treats a missing path as JSON text, which gives a confusing
# "lexical error". Fail early with a clear message instead.
if (!dir.exists(raw_dir)) stop("Folder not found: ", raw_dir)

# Keep the nested JSON structure as lists (one element per entity).
read_entities <- function(type) {
  fromJSON(file.path(raw_dir, paste0(type, ".json")), simplifyVector = FALSE)
}

# NGSI-LD wraps every attribute: {"type": "Property", "value": ..., "observedAt": ...}.
# These helpers return the value (or observedAt), NA when the attribute is missing.
val <- function(entity, attr) {
  p <- entity[[attr]]
  if (is.null(p) || is.null(p$value)) NA else p$value
}
obs_at <- function(entity, attr) {
  p <- entity[[attr]]
  if (is.null(p) || is.null(p$observedAt)) NA else p$observedAt
}
lon <- function(entity) entity$location$value$coordinates[[1]]
lat <- function(entity) entity$location$value$coordinates[[2]]


# 1. Flatten the three entity lists into data frames ----------------------

stations_raw <- read_entities("BikeHireDockingStation")
parkings_raw <- read_entities("OffStreetParking")
counters_raw <- read_entities("EcoCounter")

stations <- bind_rows(lapply(stations_raw, function(e) tibble(
  id              = e$id,
  street          = e$address$value$streetAddress,
  lon             = lon(e),
  lat             = lat(e),
  total_slots     = val(e, "totalSlotNumber"),
  available_bikes = val(e, "availableBikeNumber"),
  free_slots      = val(e, "freeSlotNumber"),
  bikes_obs_at    = obs_at(e, "availableBikeNumber"),
  free_obs_at     = obs_at(e, "freeSlotNumber"),
  status          = val(e, "status")
)))

# Static parking attributes are kept as text on purpose: some of them mix
# types (a number or "N/A"), and we want to see the raw values first.
parkings <- bind_rows(lapply(parkings_raw, function(e) tibble(
  id              = e$id,
  name            = val(e, "name"),
  address         = val(e, "address"),
  lon             = lon(e),
  lat             = lat(e),
  total_spots     = val(e, "totalSpotNumber"),
  available_spots = val(e, "availableSpotNumber"),
  status          = val(e, "status"),
  max_height      = as.character(val(e, "maximumAllowedHeight")),
  domaniality     = as.character(val(e, "domaniality")),
  parking_type    = as.character(val(e, "parkingType")),
  type_of_use     = as.character(val(e, "typeOfUse")),
  owner           = as.character(val(e, "owner"))
)))

counters <- bind_rows(lapply(counters_raw, function(e) tibble(
  id           = e$id,
  name         = as.character(val(e, "name")),
  lon          = lon(e),
  lat          = lat(e),
  lane_id      = as.character(val(e, "laneId")),
  reversed     = val(e, "reversedLane"),
  vehicle_type = val(e, "vehicleType"),
  # oldVersion is a Relationship: its target is in "object", not "value".
  old_version  = if (is.null(e$oldVersion)) NA else e$oldVersion$object
)))

glimpse(stations)
glimpse(parkings)
glimpse(counters)


# 2. Bike stations: is free = total - available? Same observedAt? ---------
# (choice 5: store freeSlotNumber or not; choice 2: one row per timestamp?)

stations %>%
  mutate(sum_ok = available_bikes + free_slots == total_slots,
         same_obs_at = bikes_obs_at == free_obs_at) %>%
  count(sum_ok, same_obs_at)

# Stations where the equality does not hold, if any.
stations %>%
  filter(available_bikes + free_slots != total_slots) %>%
  select(id, street, total_slots, available_bikes, free_slots)


# 3. Parkings: which attributes are messy? (choice 7) ----------------------

# How many parkings have live data (availableSpotNumber)?
count(parkings, has_live_data = !is.na(available_spots))

# Distinct values of the "dirty" text attributes.
count(parkings, domaniality)
count(parkings, max_height, sort = TRUE)
count(parkings, parking_type)
count(parkings, status)


# 4. Eco-counters: does laneId identify a site? (choice 1) -----------------

cat("Counters:", nrow(counters),
    "| distinct laneId:", n_distinct(counters$lane_id),
    "| distinct positions:", n_distinct(paste(counters$lon, counters$lat)), "\n")

# One row per laneId: how many counters and positions share it?
sites <- counters %>%
  group_by(lane_id) %>%
  summarise(n_counters  = n(),
            n_positions = n_distinct(paste(lon, lat)),
            names       = paste(na.omit(name), collapse = " | "),
            ids         = paste(sub(".*:", "", id), collapse = ", "),
            .groups = "drop") %>%
  arrange(desc(n_counters))

print(sites, n = Inf, width = Inf)

# Does any laneId cover several positions? (if yes, laneId is not a site id)
filter(sites, n_positions > 1)


# 5. Shared sites: two directions at the same time, or a replacement? ------

coverage_list <- fromJSON(file.path(raw_dir, "eco_counters_coverage.json"),
                          simplifyVector = FALSE)
coverage <- bind_rows(lapply(names(coverage_list), function(id) {
  c <- coverage_list[[id]]
  tibble(id    = id,
         first = as.Date(if (is.null(c$first)) NA else c$first),
         last  = as.Date(if (is.null(c$last)) NA else c$last),
         days  = if (is.null(c$days)) NA_integer_ else as.integer(c$days))
}))

shared <- counters %>%
  add_count(lane_id, name = "n_same_site") %>%
  filter(n_same_site > 1) %>%
  left_join(coverage, by = "id") %>%
  select(lane_id, id, name, reversed, old_version, first, last, days) %>%
  arrange(lane_id, first)

print(shared, n = Inf, width = Inf)

# Timeline: overlapping bars = active together, bars one after the other = replacement.
shared %>%
  filter(!is.na(first)) %>%
  mutate(counter = sub(".*:", "", id)) %>%
  ggplot(aes(y = counter, x = first, xend = last, yend = counter, colour = lane_id)) +
  geom_segment(linewidth = 3) +
  facet_grid(lane_id ~ ., scales = "free_y", space = "free_y") +
  labs(title = "Eco-counters sharing a laneId: activity period",
       x = NULL, y = NULL) +
  theme_minimal() +
  theme(legend.position = "none", strip.text.y = element_text(angle = 0))


# 6. Bike station history: do both attributes share their timestamps? ------
# (choice 2) One request: 2 hours of station 006.

resp <- request("https://portail-api-data.montpellier.fr") %>%
  req_url_path_append("ngsi-ld/v1/temporal/entities/urn:ngsi-ld:station:006") %>%
  req_url_query(attrs     = "availableBikeNumber,freeSlotNumber",
                timerel   = "between",
                timeAt    = "2026-10-12T06:00:00Z",
                endTimeAt = "2026-10-12T08:00:00Z",
                format    = "temporalValues") %>%
  req_headers(Accept = "application/json") %>%
  req_retry(max_tries = 3) %>%
  req_perform()

hist <- resp_body_json(resp)

# temporalValues: list of [value, timestamp] pairs per attribute.
to_df <- function(attr) {
  bind_rows(lapply(hist[[attr]]$values, function(p)
    tibble(observed_at = p[[2]], !!attr := p[[1]])))
}
bikes <- to_df("availableBikeNumber")
free  <- to_df("freeSlotNumber")

cat("Points:", nrow(bikes), "bikes /", nrow(free), "free slots |",
    "timestamps only in one attribute:",
    length(setdiff(bikes$observed_at, free$observed_at)) +
      length(setdiff(free$observed_at, bikes$observed_at)), "\n")

full_join(bikes, free, by = "observed_at") %>% head(10)


# 7. Map of all sensors -----------------------------------------------------

bind_rows(
  transmute(stations, type = "bike station", lon, lat),
  transmute(parkings, type = "parking", lon, lat),
  transmute(counters, type = "eco-counter", lon, lat)
) %>%
  ggplot(aes(lon, lat, colour = type)) +
  geom_point(alpha = 0.7) +
  coord_quickmap() +
  labs(title = "Sensor positions (WGS 84)", x = "longitude", y = "latitude") +
  theme_minimal()
