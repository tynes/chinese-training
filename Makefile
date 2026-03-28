# Source files
SRCS := index.html app.js data.js style.css

# Build output directory
DIST := dist

# Default target
.PHONY: all
all: build

# Build: copy source files to dist/
.PHONY: build
build: $(DIST) $(addprefix $(DIST)/,$(SRCS))

$(DIST):
	mkdir -p $(DIST)

$(DIST)/%: % | $(DIST)
	cp $< $@

# Clean: remove build output
.PHONY: clean
clean:
	rm -rf $(DIST)

# Serve locally for development (requires Python 3)
.PHONY: serve
serve: build
	cd $(DIST) && python3 -m http.server 8080

.PHONY: help
help:
	@echo "Targets:"
	@echo "  build  - Copy source files to dist/"
	@echo "  clean  - Remove dist/"
	@echo "  serve  - Build and serve locally on port 8080"
	@echo "  help   - Show this help"
